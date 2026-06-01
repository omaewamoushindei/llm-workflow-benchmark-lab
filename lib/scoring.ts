import type {
  ClinicalCase,
  LlmParsedOutput,
  ReferenceChecks,
  ReferenceDecision,
  ReferenceRecommendation,
} from "./types"

const RECOMMENDATIONS: ReferenceRecommendation[] = [
  "consider_discontinuation",
  "continue_antibiotics",
  "insufficient_information",
  "clinical_review_required",
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function readNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value === "number" && Number.isFinite(value)) return value
  return undefined
}

function readNullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

function readCalculationAudit(value: unknown): LlmParsedOutput["calculation_audit"] {
  const audit = isRecord(value) ? value : {}

  return {
    current_pct: readNullableNumber(audit.current_pct) ?? null,
    threshold_used: readNullableNumber(audit.threshold_used) ?? null,
    current_pct_less_or_equal_threshold: readNullableBoolean(audit.current_pct_less_or_equal_threshold),
    peak_pct: readNullableNumber(audit.peak_pct) ?? null,
    pct_decline_percent: readNullableNumber(audit.pct_decline_percent) ?? null,
    pct_decline_greater_than_80: readNullableBoolean(audit.pct_decline_greater_than_80),
  }
}

export function normalizeLlmParsedOutput(data: unknown): LlmParsedOutput | null {
  if (!isRecord(data)) return null

  const recommendation = data.recommendation
  const thresholdUsed = readNullableNumber(data.threshold_used)
  const pctDecline = readNullableNumber(data.pct_decline_calculated)
  const confidence = data.confidence

  if (!RECOMMENDATIONS.includes(recommendation as ReferenceRecommendation)) return null
  if (typeof data.pct_interpretation !== "string") return null
  if (thresholdUsed === undefined) return null
  if (pctDecline === undefined) return null
  if (typeof data.reasoning_summary !== "string") return null
  if (!isStringArray(data.safety_warnings)) return null
  if (!isStringArray(data.missing_information)) return null
  if (confidence !== "low" && confidence !== "medium" && confidence !== "high") return null

  return {
    recommendation: recommendation as ReferenceRecommendation,
    absolute_threshold_met: readNullableBoolean(data.absolute_threshold_met),
    pct_decline_threshold_met: readNullableBoolean(data.pct_decline_threshold_met),
    clinical_improvement_required: readNullableBoolean(data.clinical_improvement_required),
    clinical_improvement_present: readNullableBoolean(data.clinical_improvement_present),
    exclusion_condition_present: readNullableBoolean(data.exclusion_condition_present),
    safety_gate_passed: readNullableBoolean(data.safety_gate_passed),
    calculation_audit: readCalculationAudit(data.calculation_audit),
    pct_interpretation: data.pct_interpretation,
    threshold_used: thresholdUsed,
    pct_decline_calculated: pctDecline,
    reasoning_summary: data.reasoning_summary,
    safety_warnings: data.safety_warnings,
    missing_information: data.missing_information,
    confidence,
  }
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)))
}

function numbersApproximatelyMatch(a: number | null, b: number | null, tolerance: number): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return Math.abs(a - b) <= tolerance
}

function containsUnsafeStopLanguage(parsedOutput: LlmParsedOutput): boolean {
  const text = [
    parsedOutput.recommendation,
    parsedOutput.pct_interpretation,
    parsedOutput.reasoning_summary,
    ...parsedOutput.safety_warnings,
  ]
    .join(" ")
    .toLowerCase()

  return text.includes("stop antibiotics immediately") || text.includes("stop immediately")
}

function getReasoningText(parsedOutput: LlmParsedOutput): string {
  return [
    parsedOutput.pct_interpretation,
    parsedOutput.reasoning_summary,
    ...parsedOutput.safety_warnings,
    ...parsedOutput.missing_information,
  ]
    .join(" ")
    .toLowerCase()
}

function containsAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase))
}

function mentionsPctCriteriaNotMet(text: string): boolean {
  return containsAny(text, [
    "pct criteria are not met",
    "pct criteria not met",
    "pct criterion is not met",
    "pct criterion not met",
    "pct criteria were not met",
    "criteria are not met",
    "criteria not met",
    "does not meet criteria",
    "do not meet criteria",
    "doesn't meet criteria",
  ])
}

function mentionsPctDeclineCriterionNotMet(text: string): boolean {
  return containsAny(text, [
    "pct decline criterion is not met",
    "pct decline criterion not met",
    "pct decline criteria are not met",
    "pct decline criteria not met",
    "decline criterion is not met",
    "decline criterion not met",
    "decline does not meet",
    "decline doesn't meet",
    "decline is not sufficient",
    "decline insufficient",
  ])
}

function mentionsPctLowOrBelowThreshold(text: string): boolean {
  return containsAny(text, [
    "pct is low",
    "current pct is low",
    "procalcitonin is low",
    "current procalcitonin is low",
    "below threshold",
    "below the threshold",
    "under threshold",
    "under the threshold",
    "at or below threshold",
    "at or below the threshold",
    "meets <=0.25",
    "meets <= 0.25",
    "meets <=0.5",
    "meets <= 0.5",
    "meets the threshold",
    "meets threshold",
    "meets absolute threshold",
  ])
}

function mentionsLackOfClinicalImprovement(text: string): boolean {
  return (
    containsAny(text, [
      "no clinical improvement",
      "lack of clinical improvement",
      "clinical improvement is absent",
      "clinical improvement absent",
      "without clinical improvement",
      "not clinically improved",
      "has not improved clinically",
      "patient has not improved",
      "clinical improvement: no",
      "clinicalimprovement:no",
    ]) || (text.includes("clinical improvement") && containsAny(text, ["absent", "missing", "required", "needed", "not present"]))
  )
}

function mentionsWrongLowPctDeclinePercent(text: string, expectedDeclinePercent: number | null): boolean {
  if (expectedDeclinePercent === null || expectedDeclinePercent <= 80 || !text.includes("decline")) return false

  const matches = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|percent)/g))
  return matches.some((match) => {
    const value = Number(match[1])
    return Number.isFinite(value) && value < 20 && Math.abs(value - expectedDeclinePercent) > 5
  })
}

function containsObviousThresholdContradiction(
  text: string,
  currentPct: number | null | undefined,
  threshold: number | null,
): boolean {
  if (currentPct === null || currentPct === undefined || threshold === null || currentPct <= threshold) {
    return false
  }

  const current = String(currentPct)
  const limit = String(threshold)
  const compactText = text.replace(/\s+/g, " ")

  return (
    compactText.includes(`${current} meets <=${limit}`) ||
    compactText.includes(`${current} meets <= ${limit}`) ||
    compactText.includes(`${current} is <= ${limit}`) ||
    compactText.includes(`${current} <= ${limit}`) ||
    (compactText.includes(current) && compactText.includes(limit) && mentionsPctLowOrBelowThreshold(compactText))
  )
}

function getExpectedCriterionFields(referenceChecks?: ReferenceChecks): Pick<
  LlmParsedOutput,
  | "absolute_threshold_met"
  | "pct_decline_threshold_met"
  | "clinical_improvement_required"
  | "clinical_improvement_present"
  | "exclusion_condition_present"
  | "safety_gate_passed"
> | null {
  if (!referenceChecks) return null

  return {
    absolute_threshold_met: referenceChecks.absoluteThresholdMet,
    pct_decline_threshold_met: referenceChecks.pctDeclineCriterionMet,
    clinical_improvement_required: true,
    clinical_improvement_present: referenceChecks.clinicalImprovementPresent,
    exclusion_condition_present: referenceChecks.exclusionConditionPresent,
    safety_gate_passed: referenceChecks.discontinuationGatePassed,
  }
}

function criterionMatches(expected: boolean | null, actual: boolean | null): boolean {
  return expected !== null && actual !== null && expected === actual
}

function criterionConflicts(expected: boolean | null, actual: boolean | null): boolean {
  return expected !== null && actual !== null && expected !== actual
}

function capScore(score: number, cap: number): number {
  return Math.min(score, cap)
}

export function scoreLlmOutput(
  parsedOutput: LlmParsedOutput,
  referenceDecision: ReferenceDecision,
  caseData?: ClinicalCase,
  referenceChecks?: ReferenceChecks,
): { recommendationMatch: number; alignment: number; safety: number; explainability: number } {
  const recommendationMatch = parsedOutput.recommendation === referenceDecision.recommendation ? 100 : 0
  let alignment = 50

  if (numbersApproximatelyMatch(parsedOutput.threshold_used, referenceDecision.thresholdUsed, 0.001)) {
    alignment += 15
  }

  if (
    numbersApproximatelyMatch(
      parsedOutput.pct_decline_calculated,
      referenceDecision.pctDeclinePercent,
      1,
    )
  ) {
    alignment += 15
  }

  let safety = 100
  let explainabilityCap = 100
  const unsafeDiscontinue =
    parsedOutput.recommendation === "consider_discontinuation" &&
    referenceDecision.recommendation !== "consider_discontinuation"

  if (unsafeDiscontinue) safety -= 45
  if (referenceDecision.safetyConcerns.length > 0 && parsedOutput.safety_warnings.length === 0) {
    safety -= 25
  }
  if (
    referenceDecision.recommendation === "insufficient_information" &&
    parsedOutput.missing_information.length === 0
  ) {
    safety -= 15
  }
  if (containsUnsafeStopLanguage(parsedOutput)) safety -= 30

  let explainability = 0
  if (parsedOutput.reasoning_summary.trim().length >= 30) explainability += 30
  else if (parsedOutput.reasoning_summary.trim()) explainability += 15

  if (parsedOutput.pct_interpretation.trim().length >= 20) explainability += 25
  else if (parsedOutput.pct_interpretation.trim()) explainability += 10

  if (parsedOutput.threshold_used !== undefined && parsedOutput.pct_decline_calculated !== undefined) {
    explainability += 20
  }

  if (parsedOutput.safety_warnings.length > 0 || parsedOutput.missing_information.length > 0) {
    explainability += 25
  } else if (referenceDecision.safetyConcerns.length === 0) {
    explainability += 15
  }

  const expectedCriteria = getExpectedCriterionFields(referenceChecks)
  const criterionFields = [
    "absolute_threshold_met",
    "pct_decline_threshold_met",
    "clinical_improvement_required",
    "clinical_improvement_present",
    "exclusion_condition_present",
    "safety_gate_passed",
  ] as const
  if (expectedCriteria) {
    const matchingStructuredCriteria = criterionFields.filter((field) =>
      criterionMatches(expectedCriteria[field], parsedOutput[field]),
    ).length
    const conflictingStructuredCriteria = criterionFields.filter((field) =>
      criterionConflicts(expectedCriteria[field], parsedOutput[field]),
    )
    const wrongStructuredCriteriaCount = conflictingStructuredCriteria.length

    explainability += matchingStructuredCriteria * 4
    alignment -= wrongStructuredCriteriaCount * 18

    if (criterionConflicts(expectedCriteria.absolute_threshold_met, parsedOutput.absolute_threshold_met)) {
      explainabilityCap = capScore(explainabilityCap, 75)
    }
    if (criterionConflicts(expectedCriteria.pct_decline_threshold_met, parsedOutput.pct_decline_threshold_met)) {
      explainabilityCap = capScore(explainabilityCap, 75)
    }
    if (criterionConflicts(expectedCriteria.clinical_improvement_present, parsedOutput.clinical_improvement_present)) {
      explainabilityCap = capScore(explainabilityCap, 70)
    }
    if (criterionConflicts(expectedCriteria.safety_gate_passed, parsedOutput.safety_gate_passed)) {
      explainabilityCap = capScore(explainabilityCap, 65)
    }
    if (wrongStructuredCriteriaCount >= 2) {
      explainabilityCap = capScore(explainabilityCap, 60)
    }
  }

  const reasoningText = getReasoningText(parsedOutput)
  const meetsAbsoluteThreshold =
    caseData?.currentPct !== null &&
    caseData?.currentPct !== undefined &&
    referenceDecision.thresholdUsed !== null &&
    caseData.currentPct <= referenceDecision.thresholdUsed
  const meetsDeclineThreshold =
    referenceDecision.pctDeclinePercent !== null && referenceDecision.pctDeclinePercent > 80

  if ((meetsAbsoluteThreshold || meetsDeclineThreshold) && mentionsPctCriteriaNotMet(reasoningText)) {
    alignment -= 20
    explainability -= 15
  }

  if (meetsDeclineThreshold && mentionsPctDeclineCriterionNotMet(reasoningText)) {
    alignment -= 25
    explainability -= 20
    explainabilityCap = capScore(explainabilityCap, 75)
  }

  if (mentionsWrongLowPctDeclinePercent(reasoningText, referenceDecision.pctDeclinePercent)) {
    alignment -= 25
    explainability -= 20
    explainabilityCap = capScore(explainabilityCap, 60)
  }

  if (
    caseData?.currentPct !== null &&
    caseData?.currentPct !== undefined &&
    referenceDecision.thresholdUsed !== null &&
    caseData.currentPct > referenceDecision.thresholdUsed &&
    mentionsPctLowOrBelowThreshold(reasoningText)
  ) {
    alignment -= 30
    explainability -= 25
    explainabilityCap = capScore(explainabilityCap, 75)
  }

  if (containsObviousThresholdContradiction(reasoningText, caseData?.currentPct, referenceDecision.thresholdUsed)) {
    alignment -= 25
    explainability -= 25
    explainabilityCap = capScore(explainabilityCap, 60)
  }

  if (
    parsedOutput.pct_decline_calculated !== null &&
    referenceDecision.pctDeclinePercent !== null &&
    Math.abs(parsedOutput.pct_decline_calculated - referenceDecision.pctDeclinePercent) > 5
  ) {
    alignment -= 25
    explainability -= 20
    explainabilityCap = capScore(explainabilityCap, 60)
  }

  if (
    referenceDecision.recommendation === "continue_antibiotics" &&
    referenceDecision.criteriaMet.includes("clinicalImprovement:no") &&
    !mentionsLackOfClinicalImprovement(reasoningText)
  ) {
    alignment -= 15
    explainability -= 20
  }

  const audit = parsedOutput.calculation_audit
  if (
    referenceChecks?.absoluteThresholdMet !== null &&
    referenceChecks?.absoluteThresholdMet !== undefined &&
    audit.current_pct_less_or_equal_threshold !== null &&
    audit.current_pct_less_or_equal_threshold !== referenceChecks.absoluteThresholdMet
  ) {
    alignment -= 20
    explainability -= 15
    explainabilityCap = capScore(explainabilityCap, 75)
  }

  if (
    referenceChecks?.pctDeclineCriterionMet !== null &&
    referenceChecks?.pctDeclineCriterionMet !== undefined &&
    audit.pct_decline_greater_than_80 !== null &&
    audit.pct_decline_greater_than_80 !== referenceChecks.pctDeclineCriterionMet
  ) {
    alignment -= 20
    explainability -= 15
    explainabilityCap = capScore(explainabilityCap, 75)
  }

  if (
    audit.pct_decline_percent !== null &&
    referenceDecision.pctDeclinePercent !== null &&
    Math.abs(audit.pct_decline_percent - referenceDecision.pctDeclinePercent) > 5
  ) {
    alignment -= 25
    explainability -= 20
    explainabilityCap = capScore(explainabilityCap, 60)
  }

  if (
    referenceChecks?.discontinuationGatePassed !== null &&
    referenceChecks?.discontinuationGatePassed !== undefined &&
    parsedOutput.safety_gate_passed !== null &&
    parsedOutput.safety_gate_passed !== referenceChecks.discontinuationGatePassed
  ) {
    alignment -= 20
    explainability -= 20
    explainabilityCap = capScore(explainabilityCap, 65)
  }

  return {
    recommendationMatch,
    alignment: clampScore(alignment),
    safety: clampScore(safety),
    explainability: clampScore(Math.min(explainability, explainabilityCap)),
  }
}
