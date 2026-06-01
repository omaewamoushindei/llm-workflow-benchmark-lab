import type { ClinicalCase } from "./types"
import type { PromptStrategyId } from "./openrouter"

const JSON_SCHEMA = `{
  "recommendation": "consider_discontinuation" | "continue_antibiotics" | "insufficient_information" | "clinical_review_required",
  "absolute_threshold_met": boolean | null,
  "pct_decline_threshold_met": boolean | null,
  "clinical_improvement_required": boolean | null,
  "clinical_improvement_present": boolean | null,
  "exclusion_condition_present": boolean | null,
  "safety_gate_passed": boolean | null,
  "calculation_audit": {
    "current_pct": number | null,
    "threshold_used": number | null,
    "current_pct_less_or_equal_threshold": boolean | null,
    "peak_pct": number | null,
    "pct_decline_percent": number | null,
    "pct_decline_greater_than_80": boolean | null
  },
  "pct_interpretation": string,
  "threshold_used": number | null,
  "pct_decline_calculated": number | null,
  "reasoning_summary": string,
  "safety_warnings": string[],
  "missing_information": string[],
  "confidence": "low" | "medium" | "high"
}`

function formatNullableNumber(value: number | null): string {
  return value === null ? "not provided" : String(value)
}

function describeCase(caseData: ClinicalCase): string {
  return [
    `Patient age: ${formatNullableNumber(caseData.patientAge)}`,
    `Sex: ${caseData.sex || "not provided"}`,
    `Symptoms: ${caseData.symptoms || "not provided"}`,
    `Infection context: ${caseData.infectionContext}`,
    `Clinical improvement: ${caseData.clinicalImprovement}`,
    `Current antibiotic status: ${caseData.currentAntibioticStatus || "not provided"}`,
    `Antibiotics duration days: ${formatNullableNumber(caseData.antibioticsDurationDays)}`,
    `Peak PCT ng/mL: ${formatNullableNumber(caseData.peakPct)}`,
    `Current PCT ng/mL: ${formatNullableNumber(caseData.currentPct)}`,
    `WBC x10^9/L: ${formatNullableNumber(caseData.wbc)}`,
    `CRP mg/L: ${formatNullableNumber(caseData.crp)}`,
    `Exclusion/caution condition: ${caseData.exclusionCondition}`,
    `Clinical notes: ${caseData.clinicalNotes || "not provided"}`,
    `Case description: ${caseData.caseDescription || "not provided"}`,
  ].join("\n")
}

function strategyInstructions(promptStrategy: PromptStrategyId): string {
  switch (promptStrategy) {
    case "baseline":
      return [
        "Use a concise clinical evaluation style.",
        "Identify the recommendation, PCT interpretation, missing information, and major safety concerns.",
        "Keep reasoning brief.",
      ].join("\n")
    case "structured":
      return [
        "Use the schema exactly and evaluate each criterion explicitly.",
        "Separately state whether the PCT absolute threshold criterion is met.",
        "Separately state whether the PCT decline criterion (>80% decline from peak) is met.",
        "Separately state whether the clinical improvement condition is met.",
        "Check clinical improvement before recommending consider_discontinuation.",
        "List missing critical data in missing_information.",
        "List exclusion or caution conditions in safety_warnings.",
      ].join("\n")
    case "verification":
      return [
        "Before finalizing the JSON, verify these checklist items internally and summarize the result:",
        "1. Infection context and applicable threshold.",
        "2. PCT absolute threshold criterion: current PCT compared with the threshold.",
        "3. PCT decline criterion: decline from peak compared with the greater-than-80% criterion.",
        "4. Clinical improvement status.",
        "5. Exclusion or caution conditions requiring clinical review.",
        "6. Missing information that limits confidence.",
      ].join("\n")
    default: {
      const _exhaustive: never = promptStrategy
      return _exhaustive
    }
  }
}

export function buildEvaluationPrompt(
  caseData: ClinicalCase,
  promptStrategy: PromptStrategyId,
  promptTemplateText?: string,
): string {
  return `You are evaluating a model response format for a clinical decision-support benchmark.
This is an evaluation tool, not medical advice. Do not present recommendations as direct patient-care orders.
Never say "stop antibiotics immediately".
Use "consider_discontinuation" only when clinical improvement and at least one PCT criterion support it.
Distinguish the PCT absolute threshold criterion, PCT decline criterion, clinical improvement condition, and exclusion/caution conditions.
If PCT decline is >80% but clinical improvement is absent, say: "The PCT decline criterion is met, but discontinuation is not supported because clinical improvement is required."
Mention missing information.
Mention exclusion or caution conditions.
Return only valid JSON. Do not include markdown fences, prose outside JSON, or comments.

Algorithm rules:
- Clinical improvement is required before recommending consider_discontinuation.
- For LRTI/non-ICU, the absolute PCT threshold is current PCT <= 0.25 ng/mL.
- For sepsis/ICU, the absolute PCT threshold is current PCT <= 0.5 ng/mL.
- For other or unclear infection contexts, no absolute PCT threshold applies.
- The PCT decline criterion is met when decline from peak PCT is >80%.
- Exclusion/caution conditions should block automatic discontinuation and require clinical review or safety warning.
- Evaluate the absolute threshold criterion and PCT decline criterion separately. Do not say all PCT criteria are not met if either criterion is met.
- Do not call current PCT low or below threshold unless current PCT is less than or equal to the applicable threshold.
- In calculation_audit, explicitly compare current PCT to the threshold numerically.
- In calculation_audit, explicitly calculate PCT decline percentage as ((peak PCT - current PCT) / peak PCT) * 100 when both values are available.
- In calculation_audit, explicitly determine whether PCT decline is >80%.
- Do not say a criterion is met unless the numeric comparison supports it.

Required JSON schema:
${JSON_SCHEMA}

Case data:
${describeCase(caseData)}

Prompt strategy instructions:
${promptTemplateText?.trim() || strategyInstructions(promptStrategy)}

Generate the JSON object now.`
}
