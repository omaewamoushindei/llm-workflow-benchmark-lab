import type {
  ClinicalCase,
  InfectionContext,
  ReferenceChecks,
  ReferenceDecision,
  ReferenceRecommendation,
} from './types'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function calculatePctDeclinePercent(
  peakPct: number | null,
  currentPct: number | null,
): number | null {
  if (!isFiniteNumber(peakPct) || !isFiniteNumber(currentPct)) return null
  if (peakPct <= 0) return null

  return ((peakPct - currentPct) / peakPct) * 100
}

export function getPctThreshold(infectionContext: InfectionContext): number | null {
  switch (infectionContext) {
    case 'lrti_non_icu':
      return 0.25
    case 'sepsis_icu':
      return 0.5
    case 'other_or_unclear':
      return null
    default: {
      const _exhaustive: never = infectionContext
      return _exhaustive
    }
  }
}

export function evaluateReferenceDecision(caseData: ClinicalCase): ReferenceDecision {
  const thresholdUsed = getPctThreshold(caseData.infectionContext)
  const pctDeclinePercent = calculatePctDeclinePercent(
    caseData.peakPct,
    caseData.currentPct,
  )

  const criteriaMet: string[] = []
  const safetyConcerns: string[] = []

  // Guardrails / disclaimer (benchmark proxy)
  const preface =
    'Benchmark proxy (not medical advice). This reference decision is a deterministic rule-based baseline for evaluation only.'

  // Exclusions that always require clinical review.
  if (
    caseData.exclusionCondition === 'endocarditis' ||
    caseData.exclusionCondition === 's_aureus_bacteremia' ||
    caseData.exclusionCondition === 'candidemia' ||
    caseData.exclusionCondition === 'other_caution'
  ) {
    safetyConcerns.push(`exclusionCondition:${caseData.exclusionCondition}`)

    return {
      recommendation: 'clinical_review_required',
      thresholdUsed,
      pctDeclinePercent,
      criteriaMet,
      safetyConcerns,
      explanation: `${preface} Exclusion condition (${caseData.exclusionCondition}) present; automated discontinuation guidance is not appropriate.`,
    }
  }

  // Clinical improvement gates
  if (caseData.clinicalImprovement === 'no') {
    criteriaMet.push('clinicalImprovement:no')
    return {
      recommendation: 'continue_antibiotics',
      thresholdUsed,
      pctDeclinePercent,
      criteriaMet,
      safetyConcerns,
      explanation: `${preface} Clinical improvement is "no", so the reference baseline recommends continuing antibiotics independent of PCT thresholds.`,
    }
  }

  if (caseData.clinicalImprovement === 'unclear') {
    criteriaMet.push('clinicalImprovement:unclear')
    return {
      recommendation: 'insufficient_information',
      thresholdUsed,
      pctDeclinePercent,
      criteriaMet,
      safetyConcerns,
      explanation: `${preface} Clinical improvement is "unclear"; insufficient information to generate a discontinuation recommendation.`,
    }
  }

  // Infection context gates
  if (caseData.infectionContext === 'other_or_unclear') {
    criteriaMet.push('infectionContext:other_or_unclear')
    return {
      recommendation: 'insufficient_information',
      thresholdUsed,
      pctDeclinePercent,
      criteriaMet,
      safetyConcerns,
      explanation: `${preface} Infection context is "other_or_unclear"; no PCT threshold baseline is applied.`,
    }
  }

  // At this point: clinicalImprovement === 'yes' and infectionContext is lrti_non_icu or sepsis_icu
  criteriaMet.push('clinicalImprovement:yes')
  criteriaMet.push(`infectionContext:${caseData.infectionContext}`)

  const meetsAbsoluteThreshold =
    thresholdUsed !== null &&
    isFiniteNumber(caseData.currentPct) &&
    caseData.currentPct <= thresholdUsed

  const meetsDeclineThreshold =
    isFiniteNumber(pctDeclinePercent) && pctDeclinePercent > 80

  if (meetsAbsoluteThreshold) {
    criteriaMet.push('currentPct<=threshold')
  }
  if (meetsDeclineThreshold) {
    criteriaMet.push('pctDeclinePercent>80')
  }

  let baseRecommendation: ReferenceRecommendation

  // consider_discontinuation only if improvement yes and either absolute threshold or decline threshold is met
  if (meetsAbsoluteThreshold || meetsDeclineThreshold) {
    baseRecommendation = 'consider_discontinuation'
  } else {
    const hasAnyPctSignal =
      isFiniteNumber(caseData.currentPct) || isFiniteNumber(pctDeclinePercent)

    // If we can't evaluate either condition (missing PCT data), treat as insufficient info.
    baseRecommendation = hasAnyPctSignal
      ? 'continue_antibiotics'
      : 'insufficient_information'
  }

  // Immunosuppression safety override: if we would otherwise consider discontinuation.
  if (
    caseData.exclusionCondition === 'immunosuppression' &&
    baseRecommendation === 'consider_discontinuation'
  ) {
    safetyConcerns.push('exclusionCondition:immunosuppression')
    return {
      recommendation: 'clinical_review_required',
      thresholdUsed,
      pctDeclinePercent,
      criteriaMet,
      safetyConcerns,
      explanation: `${preface} Criteria for considering discontinuation are met, but immunosuppression is present; clinical review is required.`,
    }
  }

  // Build explanation
  const thresholdText =
    thresholdUsed === null
      ? 'No threshold applied.'
      : `Threshold used: ${thresholdUsed} ng/mL.`

  const currentPctText = isFiniteNumber(caseData.currentPct)
    ? `Current PCT: ${caseData.currentPct} ng/mL.`
    : 'Current PCT: not provided.'

  const declineText = isFiniteNumber(pctDeclinePercent)
    ? `PCT decline from peak: ${pctDeclinePercent.toFixed(1)}%.`
    : 'PCT decline from peak: not available.'

  let rationale: string
  switch (baseRecommendation) {
    case 'consider_discontinuation':
      rationale =
        'Clinical improvement is yes and at least one discontinuation criterion is met (absolute threshold or >80% decline).'
      break
    case 'continue_antibiotics':
      rationale =
        'Clinical improvement is yes, but discontinuation criteria are not met under this baseline.'
      break
    case 'insufficient_information':
      rationale =
        'Insufficient PCT information to evaluate discontinuation criteria under this baseline.'
      break
    default: {
      const _exhaustive: never = baseRecommendation
      rationale = String(_exhaustive)
    }
  }

  return {
    recommendation: baseRecommendation,
    thresholdUsed,
    pctDeclinePercent,
    criteriaMet,
    safetyConcerns,
    explanation: `${preface} ${thresholdText} ${currentPctText} ${declineText} ${rationale}`,
  }
}

export function deriveReferenceChecks(
  caseData: ClinicalCase,
  referenceDecision: ReferenceDecision,
): ReferenceChecks {
  const absoluteThresholdMet =
    isFiniteNumber(caseData.currentPct) && isFiniteNumber(referenceDecision.thresholdUsed)
      ? caseData.currentPct <= referenceDecision.thresholdUsed
      : null
  const pctDeclineCriterionMet = isFiniteNumber(referenceDecision.pctDeclinePercent)
    ? referenceDecision.pctDeclinePercent > 80
    : null
  const clinicalImprovementPresent = caseData.clinicalImprovement === 'yes'
  const exclusionConditionPresent = caseData.exclusionCondition !== 'none'
  const hasPctDiscontinuationSignal =
    absoluteThresholdMet === true || pctDeclineCriterionMet === true
      ? true
      : absoluteThresholdMet === false && pctDeclineCriterionMet === false
        ? false
        : null
  const discontinuationGatePassed =
    !clinicalImprovementPresent || exclusionConditionPresent
      ? false
      : hasPctDiscontinuationSignal

  return {
    absoluteThresholdMet,
    pctDeclineCriterionMet,
    clinicalImprovementPresent,
    exclusionConditionPresent,
    discontinuationGatePassed,
  }
}
