export type InfectionContext = 'lrti_non_icu' | 'sepsis_icu' | 'other_or_unclear'

export type ClinicalImprovement = 'yes' | 'no' | 'unclear'

export type ExclusionCondition =
  | 'none'
  | 'immunosuppression'
  | 'endocarditis'
  | 's_aureus_bacteremia'
  | 'candidemia'
  | 'other_caution'

export interface ClinicalCase {
  patientAge: number | null
  sex: string
  symptoms: string
  infectionContext: InfectionContext
  clinicalImprovement: ClinicalImprovement
  currentAntibioticStatus: string
  antibioticsDurationDays: number | null
  peakPct: number | null
  currentPct: number | null
  wbc: number | null
  crp: number | null
  exclusionCondition: ExclusionCondition
  clinicalNotes: string
  caseDescription: string
}

export type ReferenceRecommendation =
  | 'consider_discontinuation'
  | 'continue_antibiotics'
  | 'insufficient_information'
  | 'clinical_review_required'

export interface ReferenceDecision {
  recommendation: ReferenceRecommendation
  thresholdUsed: number | null
  pctDeclinePercent: number | null
  criteriaMet: string[]
  safetyConcerns: string[]
  explanation: string
}

export interface ReferenceChecks {
  absoluteThresholdMet: boolean | null
  pctDeclineCriterionMet: boolean | null
  clinicalImprovementPresent: boolean
  exclusionConditionPresent: boolean
  discontinuationGatePassed: boolean | null
}

export interface LlmCalculationAudit {
  current_pct: number | null
  threshold_used: number | null
  current_pct_less_or_equal_threshold: boolean | null
  peak_pct: number | null
  pct_decline_percent: number | null
  pct_decline_greater_than_80: boolean | null
}

export interface LlmParsedOutput {
  recommendation: ReferenceRecommendation
  absolute_threshold_met: boolean | null
  pct_decline_threshold_met: boolean | null
  clinical_improvement_required: boolean | null
  clinical_improvement_present: boolean | null
  exclusion_condition_present: boolean | null
  safety_gate_passed: boolean | null
  calculation_audit: LlmCalculationAudit
  pct_interpretation: string
  threshold_used: number | null
  pct_decline_calculated: number | null
  reasoning_summary: string
  safety_warnings: string[]
  missing_information: string[]
  confidence: 'low' | 'medium' | 'high'
}

export type ModelFailureReason =
  | 'rate_limited'
  | 'needs_credits'
  | 'provider_error'
  | 'no_endpoint'
  | 'invalid_key'
  | 'model_not_found'
  | 'unknown'

export type WorkflowType =
  | 'raw_baseline'
  | 'structured_prompt'
  | 'verification'
  | 'deterministic_precheck_explanation'

export interface PromptTemplate {
  id: string
  name: string
  description: string
  text: string
  expectedOutputSchema: 'pct_json' | 'free_text' | 'verification_json'
  isDefault: boolean
  updatedAt: string
}

export interface WorkflowStep {
  id: string
  name: string
  stepType: 'llm_call' | 'deterministic_precheck' | 'verification' | 'final_report'
  modelId?: string
  promptTemplateId?: string
  promptTemplateText?: string
  inputSource: 'case_data' | 'previous_step' | 'reference_checks' | 'combined'
}

export interface EvaluationWorkflow {
  id: string
  name: string
  description: string
  steps: WorkflowStep[]
  isDefault: boolean
}

export interface EvaluationConfig {
  configId: string
  label: string
  providerId: 'openrouter' | 'groq'
  workflowType: WorkflowType
  modelIds: string[]
  promptStrategy: string
  promptTemplateId?: string
  promptTemplateText?: string
}

export interface LlmEvaluationResult {
  configId: string
  modelLabel: string
  configLabel?: string
  workflowType?: WorkflowType
  workflowName?: string
  workflowStepCount?: number
  toolAssisted?: boolean
  promptStrategy: string
  status: 'success' | 'error'
  parsedOutput?: LlmParsedOutput
  rawOutput?: string
  error?: string
  failureReason?: ModelFailureReason
  retryCount?: number
  scores?: {
    recommendationMatch?: number
    alignment: number
    safety: number
    explainability: number
  }
}

export interface EvaluationResponse {
  caseData: ClinicalCase
  referenceDecision: ReferenceDecision
  referenceChecks?: ReferenceChecks
  results: LlmEvaluationResult[]
  metadata?: {
    evaluationMode: 'mock' | 'live'
    providerId?: 'openrouter' | 'groq'
    providerLabel?: string
  }
}
