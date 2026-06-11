import { NextResponse } from 'next/server'

import { parseLlmJson } from '@/lib/json-utils'
import { callProviderChatCompletion, type LlmProviderId } from '@/lib/llm-providers'
import { type PromptStrategyId } from '@/lib/openrouter'
import { deriveReferenceChecks, evaluateReferenceDecision } from '@/lib/pct-reference'
import { buildEvaluationPrompt } from '@/lib/prompt-builder'
import { normalizeLlmParsedOutput, scoreLlmOutput } from '@/lib/scoring'
import type {
  ClinicalCase,
  BenchmarkConfig,
  EvaluationResponse,
  EvaluationWorkflow,
  LlmEvaluationResult,
  LlmParsedOutput,
  ReferenceChecks,
  ReferenceDecision,
  ReferenceRecommendation,
  RunControls,
  WorkflowStep,
  WorkflowStepTrace,
} from '@/lib/types'

type PromptStrategy = 'Baseline Prompt' | 'Structured Prompt' | 'Verification Prompt'

type MockModel = {
  configId: string
  modelLabel: string
  promptStrategy: PromptStrategy
}

type ProviderEvaluationConfig = {
  configId: string
  modelLabel: string
  modelId: string
  promptStrategy: PromptStrategyId
  promptTemplateId?: string
  promptTemplateText?: string
  configLabel?: string
  configType?: 'model_only' | 'workflow'
  workflowName?: string
  workflowStepCount?: number
  toolAssisted?: boolean
  workflow?: EvaluationWorkflow
}

const DEFAULT_RUN_CONTROLS: RunControls = {
  delayBetweenCallsMs: 0,
  delayBetweenWorkflowStepsMs: 0,
  maxRetries: 0,
  retryBackoffMode: 'provider_hint',
  maxOutputTokens: 1000,
  compactPromptMode: false,
  continueOnError: true,
  stopAfterFailureRatePercent: 100,
  maxCasesPerRun: 1,
  maxConfigsPerRun: 1,
}

const OPENROUTER_FALLBACK_CONFIGS: ProviderEvaluationConfig[] = [
  {
    configId: 'meta-llama-llama-3.2-3b-instruct-free_baseline',
    modelLabel: 'Llama 3.2 3B Instruct Free',
    modelId: 'meta-llama/llama-3.2-3b-instruct:free',
    promptStrategy: 'baseline',
  },
  {
    configId: 'google-gemma-3-4b-it-free_structured',
    modelLabel: 'Gemma 3 4B IT Free',
    modelId: 'google/gemma-3-4b-it:free',
    promptStrategy: 'structured',
  },
  {
    configId: 'mistralai-mistral-7b-instruct-free_verification',
    modelLabel: 'Mistral 7B Instruct Free',
    modelId: 'mistralai/mistral-7b-instruct:free',
    promptStrategy: 'verification',
  },
]

const GROQ_FALLBACK_CONFIGS: ProviderEvaluationConfig[] = [
  {
    configId: 'groq-llama-3.1-8b-instant_baseline',
    modelLabel: 'Llama 3.1 8B Instant',
    modelId: 'llama-3.1-8b-instant',
    promptStrategy: 'baseline',
  },
  {
    configId: 'groq-gemma2-9b-it_structured',
    modelLabel: 'Gemma2 9B IT',
    modelId: 'gemma2-9b-it',
    promptStrategy: 'structured',
  },
  {
    configId: 'groq-llama-3.3-70b-versatile_verification',
    modelLabel: 'Llama 3.3 70B Versatile',
    modelId: 'llama-3.3-70b-versatile',
    promptStrategy: 'verification',
  },
]

const MOCK_MODELS: MockModel[] = [
  {
    configId: 'gpt-4o-mini_baseline',
    modelLabel: 'GPT-4o mini',
    promptStrategy: 'Baseline Prompt',
  },
  {
    configId: 'gemini-flash_structured',
    modelLabel: 'Gemini Flash',
    promptStrategy: 'Structured Prompt',
  },
  {
    configId: 'llama-3.1_verification',
    modelLabel: 'Llama 3.1',
    promptStrategy: 'Verification Prompt',
  },
]

function getPromptStrategyLabel(promptStrategy: PromptStrategyId): PromptStrategy {
  switch (promptStrategy) {
    case 'baseline':
      return 'Baseline Prompt'
    case 'structured':
      return 'Structured Prompt'
    case 'verification':
      return 'Verification Prompt'
    default: {
      const _exhaustive: never = promptStrategy
      return _exhaustive
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseEvaluateRequestBody(body: unknown): {
  caseData: ClinicalCase
  selectedModelIds: string[]
  providerId: LlmProviderId
  apiKey: string | null
  defaultPromptTemplateId?: string
  defaultPromptTemplateText?: string
  executionConfig?: ProviderEvaluationConfig
  runControls: RunControls
} {
  if (isRecord(body) && isRecord(body.caseData)) {
    const rawSelected = body.selectedModelIds ?? body.selectedModels
    const selectedModelIds = Array.isArray(rawSelected)
      ? rawSelected.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : []
    const providerId = body.providerId === 'groq' ? 'groq' : 'openrouter'
    const apiKey =
      typeof body.apiKey === 'string' && body.apiKey.trim()
        ? body.apiKey.trim()
        : null

    return {
      caseData: body.caseData as unknown as ClinicalCase,
      selectedModelIds,
      providerId,
      apiKey,
      defaultPromptTemplateId:
        typeof body.defaultPromptTemplateId === 'string' && body.defaultPromptTemplateId.trim()
          ? body.defaultPromptTemplateId.trim()
          : undefined,
      defaultPromptTemplateText:
        typeof body.defaultPromptTemplateText === 'string' && body.defaultPromptTemplateText.trim()
          ? body.defaultPromptTemplateText
          : undefined,
      executionConfig: parseExecutionConfig(body.executionConfig, providerId),
      runControls: parseRunControls(body.runControls),
    }
  }

  return {
    caseData: body as ClinicalCase,
    selectedModelIds: [],
    providerId: 'openrouter',
    apiKey: null,
    defaultPromptTemplateId: undefined,
    defaultPromptTemplateText: undefined,
    executionConfig: undefined,
    runControls: DEFAULT_RUN_CONTROLS,
  }
}

function parseRunControls(value: unknown): RunControls {
  if (!isRecord(value)) return DEFAULT_RUN_CONTROLS
  return {
    ...DEFAULT_RUN_CONTROLS,
    maxOutputTokens: readNumber(value.maxOutputTokens, DEFAULT_RUN_CONTROLS.maxOutputTokens, 2000),
    delayBetweenWorkflowStepsMs: readNumber(
      value.delayBetweenWorkflowStepsMs,
      DEFAULT_RUN_CONTROLS.delayBetweenWorkflowStepsMs,
      60000,
    ),
  }
}

function readNumber(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(0, Math.round(value)), max)
}

function parsePromptStrategy(value: unknown): PromptStrategyId {
  if (value === 'structured' || value === 'verification') return value
  return 'baseline'
}

function parseWorkflowStep(value: unknown): WorkflowStep | null {
  if (!isRecord(value)) return null
  const stepType = value.stepType
  if (
    stepType !== 'llm_call' &&
    stepType !== 'deterministic_precheck' &&
    stepType !== 'verification' &&
    stepType !== 'final_report'
  ) {
    return null
  }
  return {
    id: typeof value.id === 'string' ? value.id : `step-${Math.random().toString(36).slice(2)}`,
    name: typeof value.name === 'string' ? value.name : 'Workflow step',
    stepType,
    modelId: typeof value.modelId === 'string' ? value.modelId : undefined,
    promptTemplateId: typeof value.promptTemplateId === 'string' ? value.promptTemplateId : undefined,
    promptTemplateText: typeof value.promptTemplateText === 'string' ? value.promptTemplateText : undefined,
    inputSource:
      value.inputSource === 'previous_step' ||
      value.inputSource === 'reference_checks' ||
      value.inputSource === 'combined' ||
      value.inputSource === 'case_data'
        ? value.inputSource
        : 'case_data',
  }
}

function parseWorkflow(value: unknown): EvaluationWorkflow | undefined {
  if (!isRecord(value) || !Array.isArray(value.steps)) return undefined
  const steps = value.steps.map(parseWorkflowStep).filter((step): step is WorkflowStep => step !== null)
  if (steps.length === 0) return undefined
  return {
    id: typeof value.id === 'string' ? value.id : 'execution-workflow',
    name: typeof value.name === 'string' ? value.name : 'Execution Workflow',
    description: typeof value.description === 'string' ? value.description : '',
    steps,
    isDefault: Boolean(value.isDefault),
  }
}

function parseExecutionConfig(value: unknown, fallbackProviderId: LlmProviderId): ProviderEvaluationConfig | undefined {
  if (!isRecord(value)) return undefined
  const candidate = value as Partial<BenchmarkConfig> & Record<string, unknown>
  const workflow = parseWorkflow(candidate.workflow)
  const configType = candidate.configType === 'workflow' ? 'workflow' : 'model_only'
  const modelId =
    typeof candidate.modelId === 'string'
      ? candidate.modelId
      : workflow?.steps.find((step) => step.modelId)?.modelId
  if (!modelId && !workflow) return undefined

  const configId =
    typeof candidate.configId === 'string' && candidate.configId.trim()
      ? candidate.configId.trim().replace(/[^a-zA-Z0-9._-]/g, '-')
      : `execution-${Date.now()}`
  const label = typeof candidate.label === 'string' ? candidate.label : configId
  const promptTemplateText =
    typeof candidate.promptTemplateText === 'string' && candidate.promptTemplateText.trim()
      ? candidate.promptTemplateText
      : undefined

  return {
    configId,
    modelLabel: typeof candidate.modelLabel === 'string' ? candidate.modelLabel : modelId ?? label,
    modelId: modelId ?? '',
    promptStrategy: parsePromptStrategy(candidate.promptStrategy),
    promptTemplateId: typeof candidate.promptTemplateId === 'string' ? candidate.promptTemplateId : undefined,
    promptTemplateText,
    configLabel: label,
    configType,
    workflowName: workflow?.name,
    workflowStepCount: typeof candidate.stepCount === 'number' ? candidate.stepCount : workflow?.steps.length,
    toolAssisted: Boolean(candidate.toolAssisted) || Boolean(workflow?.steps.some((step) => step.stepType === 'deterministic_precheck')),
    workflow,
  }
}

function buildMockParsedOutput(args: {
  model: MockModel
  caseData: ClinicalCase
  reference: ReferenceDecision
  referenceChecks: ReferenceChecks
  recommendation: ReferenceRecommendation
}): LlmParsedOutput {
  const { model, caseData, reference, referenceChecks, recommendation } = args

  const commonMissing: string[] = []
  if (caseData.currentPct === null) commonMissing.push('currentPct')
  if (caseData.peakPct === null) commonMissing.push('peakPct')
  if (caseData.antibioticsDurationDays === null) commonMissing.push('antibioticsDurationDays')

  const thresholdText =
    reference.thresholdUsed === null
      ? 'No PCT threshold applied for this context.'
      : `Context threshold: ${reference.thresholdUsed} ng/mL.`

  const pctText =
    caseData.currentPct === null
      ? 'Current PCT not provided.'
      : `Current PCT: ${caseData.currentPct} ng/mL.`

  const declineText =
    reference.pctDeclinePercent === null
      ? 'PCT decline from peak not available.'
      : `PCT decline from peak: ${reference.pctDeclinePercent.toFixed(1)}%.`

  const exclusionWarningText =
    caseData.exclusionCondition === 'none'
      ? null
      : `Exclusion condition present: ${caseData.exclusionCondition}.`

  const safetyWarnings: string[] = []
  let missingInformation: string[] = [...commonMissing]

  let pctInterpretation = `${thresholdText} ${pctText} ${declineText}`
  let reasoningSummary = ''

  if (model.promptStrategy === 'Baseline Prompt') {
    // Less complete, shorter, may miss missing-info callouts.
    pctInterpretation = `${pctText}`
    missingInformation = []
    reasoningSummary =
      'Based on PCT and clinical status, provide a stewardship recommendation with minimal structure.'
  }

  if (model.promptStrategy === 'Structured Prompt') {
    // Usually aligns; emphasizes criteria mapping.
    reasoningSummary =
      'Mapped case context to threshold/decline criteria and clinical improvement, then produced a recommendation.'
  }

  if (model.promptStrategy === 'Verification Prompt') {
    // Emphasize exclusions and safety.
    if (exclusionWarningText) {
      safetyWarnings.push(exclusionWarningText)
      safetyWarnings.push(
        'High-risk context: automated discontinuation may be inappropriate; consider expert review.',
      )
    }
    reasoningSummary =
      'Performed a safety-first verification pass: checked exclusions, clinical improvement, and PCT criteria before recommending.'
  }

  // Missing critical information should be treated as a caution.
  // Note: Baseline prompt may omit missing_information fields, but missing critical PCT inputs
  // should still be surfaced via safety warnings.
  const criticalMissing = commonMissing.filter(
    (field) => field === 'currentPct' || field === 'peakPct',
  )
  if (criticalMissing.length > 0) {
    safetyWarnings.push(`Missing critical information: ${criticalMissing.join(', ')}.`)
  }

  // Uncertainty: if the baseline reference (or this output) indicates insufficient information.
  if (reference.recommendation === 'insufficient_information' || recommendation === 'insufficient_information') {
    safetyWarnings.push('Uncertain: insufficient information to make a confident stewardship recommendation.')
  }

  // Safety warnings for risky recs
  if (
    reference.recommendation === 'clinical_review_required' &&
    recommendation === 'consider_discontinuation'
  ) {
    safetyWarnings.push('Potentially unsafe: recommends discontinuation despite reference requiring clinical review.')
  }

  if (
    reference.recommendation === 'continue_antibiotics' &&
    recommendation === 'consider_discontinuation'
  ) {
    safetyWarnings.push('Potentially unsafe: recommends discontinuation when reference baseline suggests continuing antibiotics.')
  }

  return {
    recommendation,
    absolute_threshold_met: referenceChecks.absoluteThresholdMet,
    pct_decline_threshold_met: referenceChecks.pctDeclineCriterionMet,
    clinical_improvement_required: true,
    clinical_improvement_present: referenceChecks.clinicalImprovementPresent,
    exclusion_condition_present: referenceChecks.exclusionConditionPresent,
    safety_gate_passed: referenceChecks.discontinuationGatePassed,
    calculation_audit: {
      current_pct: caseData.currentPct,
      threshold_used: reference.thresholdUsed,
      current_pct_less_or_equal_threshold: referenceChecks.absoluteThresholdMet,
      peak_pct: caseData.peakPct,
      pct_decline_percent: reference.pctDeclinePercent,
      pct_decline_greater_than_80: referenceChecks.pctDeclineCriterionMet,
    },
    pct_interpretation: pctInterpretation,
    threshold_used: reference.thresholdUsed,
    pct_decline_calculated: reference.pctDeclinePercent,
    reasoning_summary: reasoningSummary,
    safety_warnings: safetyWarnings,
    missing_information: missingInformation,
    confidence: model.promptStrategy === 'Baseline Prompt' ? 'medium' : 'high',
  }
}

function pickMockRecommendation(args: {
  model: MockModel
  reference: ReferenceDecision
  caseData: ClinicalCase
}): ReferenceRecommendation {
  const { model, reference, caseData } = args

  const hasExclusionOrCaution = caseData.exclusionCondition !== 'none'

  // Deterministic mock behavior tailored to the prompt strategy.
  if (reference.recommendation === 'clinical_review_required') {
    // If clinical review is required due to an exclusion/caution, keep baseline unsafe
    // but ensure structured + verification align with the reference.
    if (hasExclusionOrCaution && model.promptStrategy === 'Baseline Prompt') {
      return 'consider_discontinuation'
    }

    return 'clinical_review_required'
  }

  if (reference.recommendation === 'consider_discontinuation') {
    // Clean cases should not be overly conservative: verification must align.
    return 'consider_discontinuation'
  }

  if (
    reference.recommendation === 'continue_antibiotics' ||
    reference.recommendation === 'insufficient_information'
  ) {
    // Structured and verification should align with the reference.
    if (
      model.promptStrategy === 'Structured Prompt' ||
      model.promptStrategy === 'Verification Prompt'
    ) {
      return reference.recommendation
    }

    // Baseline can be less complete, but should still align by default.
    return reference.recommendation
  }

  return reference.recommendation
}

function buildMockResults(
  caseData: ClinicalCase,
  reference: ReferenceDecision,
  referenceChecks: ReferenceChecks,
): LlmEvaluationResult[] {
  return MOCK_MODELS.map((model) => {
    const recommendation = pickMockRecommendation({ model, reference, caseData })

    const parsedOutput = buildMockParsedOutput({
      model,
      caseData,
      reference,
      referenceChecks,
      recommendation,
    })

    const scores = scoreLlmOutput(parsedOutput, reference, caseData, referenceChecks)

    return {
      configId: model.configId,
      modelLabel: model.modelLabel,
      promptStrategy: model.promptStrategy,
      status: 'success',
      parsedOutput,
      rawOutput: JSON.stringify(parsedOutput, null, 2),
      scores,
    }
  })
}

function buildCustomProviderConfigs(
  selectedModelIds: string[],
  defaultPromptTemplateText?: string,
  defaultPromptTemplateId?: string,
): ProviderEvaluationConfig[] {
  const uniqueModelIds = Array.from(new Set(selectedModelIds.map((id) => id.trim()).filter(Boolean))).slice(0, 3)
  const promptStrategies: PromptStrategyId[] = ['baseline', 'structured', 'verification']

  return uniqueModelIds.map((modelId, index) => ({
    configId: `${modelId}_${promptStrategies[index]}`.replace(/[^a-zA-Z0-9._-]/g, '-'),
    modelLabel: modelId,
    modelId,
    promptStrategy: defaultPromptTemplateText ? 'baseline' : promptStrategies[index],
    promptTemplateId: defaultPromptTemplateId,
    promptTemplateText: defaultPromptTemplateText,
  }))
}

function getFallbackProviderConfigs(providerId: LlmProviderId): ProviderEvaluationConfig[] {
  return providerId === 'groq' ? GROQ_FALLBACK_CONFIGS : OPENROUTER_FALLBACK_CONFIGS
}

function getProviderLabel(providerId: LlmProviderId): string {
  return providerId === 'groq' ? 'Groq' : 'OpenRouter'
}

class WorkflowStepExecutionError extends Error {
  failedStepName: string
  failedStepIndex: number
  workflowTrace?: WorkflowStepTrace[]

  constructor(error: unknown, failedStepName: string, failedStepIndex: number, workflowTrace?: WorkflowStepTrace[]) {
    super(error instanceof Error ? error.message : 'Workflow step failed.')
    this.name = 'WorkflowStepExecutionError'
    this.failedStepName = failedStepName
    this.failedStepIndex = failedStepIndex
    this.workflowTrace = workflowTrace
  }
}

function getWorkflowTrace(error: unknown): WorkflowStepTrace[] | undefined {
  return error instanceof WorkflowStepExecutionError ? error.workflowTrace : undefined
}

function getFailedStepName(error: unknown): string | undefined {
  return error instanceof WorkflowStepExecutionError ? error.failedStepName : undefined
}

function getFailedStepIndex(error: unknown): number | undefined {
  return error instanceof WorkflowStepExecutionError ? error.failedStepIndex : undefined
}

function previewText(value: string, limit = 500): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit)}...`
}

type WorkflowStepOutput = {
  stepId: string
  stepName: string
  stepType: WorkflowStep['stepType']
  output: string
}

type ResolvedWorkflowInput = {
  prompt: string
  summary: string
  previousStepOutputIncluded: boolean
  includedStepOutputIds: string[]
  referenceChecksIncluded: boolean
}

function formatWorkflowStepOutputs(outputs: WorkflowStepOutput[]): string {
  return outputs
    .map((output, index) => `Step ${index + 1} (${output.stepName}, ${output.stepId}):\n${output.output}`)
    .join('\n\n')
}

function resolveWorkflowStepInput(args: {
  step: WorkflowStep
  stepIndex: number
  caseData: ClinicalCase
  referenceChecks: ReferenceChecks
  stepOutputs: WorkflowStepOutput[]
}): ResolvedWorkflowInput {
  const { step, stepIndex, caseData, referenceChecks, stepOutputs } = args
  const latestOutput = stepOutputs[stepOutputs.length - 1]
  const deterministicOutputIncluded = stepOutputs.some((output) => output.stepType === 'deterministic_precheck')

  if ((step.inputSource === 'previous_step' || step.inputSource === 'combined') && stepIndex > 0 && !latestOutput) {
    throw new Error(`Missing previous step output for step ${step.name}.`)
  }

  if (step.inputSource === 'previous_step') {
    return {
      prompt: `Previous step output (${latestOutput?.stepName ?? 'none'}):\n${latestOutput?.output ?? ''}`,
      summary: latestOutput
        ? `Immediate previous step output included: ${latestOutput.stepName}.`
        : 'No previous step output was available.',
      previousStepOutputIncluded: Boolean(latestOutput),
      includedStepOutputIds: latestOutput ? [latestOutput.stepId] : [],
      referenceChecksIncluded: latestOutput?.stepType === 'deterministic_precheck',
    }
  }

  if (step.inputSource === 'reference_checks') {
    return {
      prompt: `Deterministic reference checks:\n${JSON.stringify({ referenceChecks }, null, 2)}`,
      summary: 'Deterministic reference checks only.',
      previousStepOutputIncluded: false,
      includedStepOutputIds: [],
      referenceChecksIncluded: true,
    }
  }

  if (step.inputSource === 'combined') {
    return {
      prompt: `Case data:\n${JSON.stringify(caseData, null, 2)}\n\nPrevious workflow step outputs:\n${formatWorkflowStepOutputs(stepOutputs)}`,
      summary: `Case data plus ${stepOutputs.length} previous step output${stepOutputs.length === 1 ? '' : 's'}.`,
      previousStepOutputIncluded: stepOutputs.length > 0,
      includedStepOutputIds: stepOutputs.map((output) => output.stepId),
      referenceChecksIncluded: deterministicOutputIncluded,
    }
  }

  return {
    prompt: `Case data:\n${JSON.stringify(caseData, null, 2)}`,
    summary: 'Original case data and case context only.',
    previousStepOutputIncluded: false,
    includedStepOutputIds: [],
    referenceChecksIncluded: false,
  }
}

async function buildProviderResult(args: {
  providerId: LlmProviderId
  config: ProviderEvaluationConfig
  caseData: ClinicalCase
  referenceDecision: ReferenceDecision
  referenceChecks: ReferenceChecks
  apiKey: string
}): Promise<LlmEvaluationResult> {
  const { providerId, config, caseData, referenceDecision, referenceChecks, apiKey } = args
  const prompt = buildEvaluationPrompt(caseData, config.promptStrategy, config.promptTemplateText)
  const promptStrategy = getPromptStrategyLabel(config.promptStrategy)

  const workflowExecution = config.workflow
    ? await executeWorkflow({
        providerId,
        apiKey,
        config,
        caseData,
        referenceDecision,
        referenceChecks,
        maxTokens: 1000,
      })
    : null

  const rawOutput =
    workflowExecution?.finalRawOutput ??
    (await callProviderChatCompletion(
      providerId,
      apiKey,
      config.modelId,
      [{ role: 'user', content: prompt }],
      { temperature: 0.1, max_tokens: 1000 },
    ))

  const parsedJson = parseLlmJson(rawOutput)
  if (!parsedJson.ok) {
    return {
      configId: config.configId,
      modelLabel: config.modelLabel,
      promptStrategy,
      status: 'error',
      rawOutput,
      error: `Could not parse valid JSON: ${parsedJson.error}`,
      workflowTrace: workflowExecution?.trace,
    }
  }

  const parsedOutput = normalizeLlmParsedOutput(parsedJson.data)
  if (!parsedOutput) {
    return {
      configId: config.configId,
      modelLabel: config.modelLabel,
      promptStrategy,
      status: 'error',
      rawOutput,
      error: 'Model JSON did not match the required evaluation schema',
      workflowTrace: workflowExecution?.trace,
    }
  }

  return {
    configId: config.configId,
    modelLabel: config.modelLabel,
    configLabel: config.configLabel,
    configType: config.configType,
    workflowName: config.workflowName,
    workflowStepCount: config.workflowStepCount,
    toolAssisted: config.toolAssisted,
    promptStrategy,
    status: 'success',
    parsedOutput,
    rawOutput: workflowExecution?.rawOutput ?? rawOutput,
    workflowTrace: workflowExecution?.trace,
    scores: scoreLlmOutput(parsedOutput, referenceDecision, caseData, referenceChecks),
  }
}

function buildWorkflowStepPrompt(args: {
  step: WorkflowStep
  caseData: ClinicalCase
  referenceChecks: ReferenceChecks
  stepIndex: number
  stepOutputs: WorkflowStepOutput[]
}): string {
  const { step, caseData, referenceChecks, stepIndex, stepOutputs } = args
  const basePrompt = step.promptTemplateText || buildEvaluationPrompt(caseData, step.stepType === 'verification' ? 'verification' : 'structured')
  const resolvedInput = resolveWorkflowStepInput({ step, stepIndex, caseData, referenceChecks, stepOutputs })

  return `${basePrompt}

Workflow step:
- Step name: ${step.name}
- Step type: ${step.stepType}
- Input source: ${step.inputSource}

Resolved workflow input:
${resolvedInput.prompt}

Return the JSON object for this step.`
}

async function executeWorkflow(args: {
  providerId: LlmProviderId
  apiKey: string
  config: ProviderEvaluationConfig
  caseData: ClinicalCase
  referenceDecision: ReferenceDecision
  referenceChecks: ReferenceChecks
  maxTokens: number
}): Promise<{ finalRawOutput: string; rawOutput: string; trace: WorkflowStepTrace[] }> {
  const { providerId, apiKey, config, caseData, referenceChecks, maxTokens } = args
  const workflow = config.workflow
  if (!workflow) throw new Error('Execution workflow is missing workflow steps.')

  let previousOutput = ''
  const stepOutputs: WorkflowStepOutput[] = []
  const trace: WorkflowStepTrace[] = []

  for (const [index, step] of workflow.steps.entries()) {
    let resolvedInput: ResolvedWorkflowInput
    try {
      resolvedInput = resolveWorkflowStepInput({ step, stepIndex: index, caseData, referenceChecks, stepOutputs })
    } catch (error) {
      const failedTrace: WorkflowStepTrace = {
        stepId: step.id,
        stepName: step.name,
        stepType: step.stepType,
        modelId: step.modelId,
        promptTemplateId: step.promptTemplateId,
        inputSource: step.inputSource,
        resolvedInputSummary: error instanceof Error ? error.message : 'Could not resolve workflow input.',
        previousStepOutputIncluded: false,
        includedStepOutputIds: [],
        referenceChecksIncluded: false,
        parsedSuccessfully: false,
        error: error instanceof Error ? error.message : 'Could not resolve workflow input.',
      }
      throw new WorkflowStepExecutionError(error, step.name, index, [...trace, failedTrace])
    }

    if (step.stepType === 'deterministic_precheck') {
      previousOutput = JSON.stringify({ referenceChecks }, null, 2)
      stepOutputs.push({ stepId: step.id, stepName: step.name, stepType: step.stepType, output: previousOutput })
      trace.push({
        stepId: step.id,
        stepName: step.name,
        stepType: step.stepType,
        modelId: step.modelId,
        promptTemplateId: step.promptTemplateId,
        inputSource: step.inputSource,
        resolvedInputSummary: resolvedInput.summary,
        previousStepOutputIncluded: resolvedInput.previousStepOutputIncluded,
        includedStepOutputIds: resolvedInput.includedStepOutputIds,
        referenceChecksIncluded: true,
        outputPreview: previewText(previousOutput),
        parsedSuccessfully: true,
      })
      continue
    }

    const modelId = step.modelId || config.modelId
    if (!modelId) {
      const error = new Error(`Workflow step "${step.name}" is missing a model.`)
      const failedTrace: WorkflowStepTrace = {
        stepId: step.id,
        stepName: step.name,
        stepType: step.stepType,
        modelId: step.modelId,
        promptTemplateId: step.promptTemplateId,
        inputSource: step.inputSource,
        resolvedInputSummary: resolvedInput.summary,
        previousStepOutputIncluded: resolvedInput.previousStepOutputIncluded,
        includedStepOutputIds: resolvedInput.includedStepOutputIds,
        referenceChecksIncluded: resolvedInput.referenceChecksIncluded,
        parsedSuccessfully: false,
        error: error.message,
      }
      throw new WorkflowStepExecutionError(error, step.name, index, [...trace, failedTrace])
    }

    try {
      previousOutput = await callProviderChatCompletion(
        providerId,
        apiKey,
        modelId,
        [
          {
            role: 'user',
            content: buildWorkflowStepPrompt({
              step,
              caseData,
              referenceChecks,
              stepIndex: index,
              stepOutputs,
            }),
          },
        ],
        { temperature: 0.1, max_tokens: maxTokens },
      )
    } catch (error) {
      const failedTrace: WorkflowStepTrace = {
        stepId: step.id,
        stepName: step.name,
        stepType: step.stepType,
        modelId,
        promptTemplateId: step.promptTemplateId,
        inputSource: step.inputSource,
        resolvedInputSummary: resolvedInput.summary,
        previousStepOutputIncluded: resolvedInput.previousStepOutputIncluded,
        includedStepOutputIds: resolvedInput.includedStepOutputIds,
        referenceChecksIncluded: resolvedInput.referenceChecksIncluded,
        parsedSuccessfully: false,
        error: error instanceof Error ? error.message : 'Workflow provider call failed.',
      }
      throw new WorkflowStepExecutionError(error, step.name, index, [...trace, failedTrace])
    }

    stepOutputs.push({ stepId: step.id, stepName: step.name, stepType: step.stepType, output: previousOutput })
    trace.push({
      stepId: step.id,
      stepName: step.name,
      stepType: step.stepType,
      modelId,
      promptTemplateId: step.promptTemplateId,
      inputSource: step.inputSource,
      resolvedInputSummary: resolvedInput.summary,
      previousStepOutputIncluded: resolvedInput.previousStepOutputIncluded,
      includedStepOutputIds: resolvedInput.includedStepOutputIds,
      referenceChecksIncluded: resolvedInput.referenceChecksIncluded,
      outputPreview: previewText(previousOutput),
      parsedSuccessfully: parseLlmJson(previousOutput).ok,
    })
  }

  return {
    finalRawOutput: previousOutput,
    rawOutput: JSON.stringify({ workflow: workflow.name, steps: stepOutputs }, null, 2),
    trace,
  }
}

function buildMissingApiKeyResults(configs: ProviderEvaluationConfig[]): LlmEvaluationResult[] {
  return configs.map((config) => ({
    configId: config.configId,
    modelLabel: config.modelLabel,
    promptStrategy: getPromptStrategyLabel(config.promptStrategy),
    status: 'error',
    error: 'No API key connected for selected provider.',
  }))
}

async function buildProviderResults(
  caseData: ClinicalCase,
  referenceDecision: ReferenceDecision,
  referenceChecks: ReferenceChecks,
  providerId: LlmProviderId,
  selectedModelIds: string[],
  apiKey: string | null,
  defaultPromptTemplateText?: string,
  defaultPromptTemplateId?: string,
  executionConfig?: ProviderEvaluationConfig,
): Promise<LlmEvaluationResult[]> {
  const configs =
    executionConfig
      ? [executionConfig]
    : selectedModelIds.length > 0
      ? buildCustomProviderConfigs(selectedModelIds, defaultPromptTemplateText, defaultPromptTemplateId)
      : getFallbackProviderConfigs(providerId).map((config) => ({
          ...config,
          promptTemplateId: defaultPromptTemplateId ?? config.promptTemplateId,
          promptTemplateText: defaultPromptTemplateText ?? config.promptTemplateText,
        }))

  if (!apiKey) {
    return buildMissingApiKeyResults(configs)
  }

  const settled = await Promise.allSettled(
    configs.map(async (config) => {
      return buildProviderResult({
        providerId,
        config,
        caseData,
        referenceDecision,
        referenceChecks,
        apiKey,
      })
    }),
  )

  return settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value

    const config = configs[index]
    const message = result.reason instanceof Error ? result.reason.message : 'Unknown provider error'

    return {
      configId: config.configId,
      modelLabel: config.modelLabel,
      configLabel: config.configLabel,
      configType: config.configType,
      workflowName: config.workflowName,
      workflowStepCount: config.workflowStepCount,
      toolAssisted: config.toolAssisted,
      promptStrategy: getPromptStrategyLabel(config.promptStrategy),
      status: 'error',
      error: message,
      failedStepName: getFailedStepName(result.reason),
      failedStepIndex: getFailedStepIndex(result.reason),
      workflowTrace: getWorkflowTrace(result.reason),
    }
  })
}

export async function POST(request: Request) {
  let caseData: ClinicalCase
  let selectedModelIds: string[] = []
  let providerId: LlmProviderId = 'openrouter'
  let apiKey: string | null = null
  let defaultPromptTemplateId: string | undefined
  let defaultPromptTemplateText: string | undefined
  let executionConfig: ProviderEvaluationConfig | undefined

  try {
    // No zod validation yet by design.
    const parsed = parseEvaluateRequestBody(await request.json())
    caseData = parsed.caseData
    selectedModelIds = parsed.selectedModelIds
    providerId = parsed.providerId
    apiKey = parsed.apiKey
    defaultPromptTemplateId = parsed.defaultPromptTemplateId
    defaultPromptTemplateText = parsed.defaultPromptTemplateText
    executionConfig = parsed.executionConfig
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const referenceDecision = evaluateReferenceDecision(caseData)
    const referenceChecks = deriveReferenceChecks(caseData, referenceDecision)
    const isMockMode = process.env.USE_MOCK_LLM === 'true'
    const results =
      isMockMode
        ? buildMockResults(caseData, referenceDecision, referenceChecks)
        : await buildProviderResults(
            caseData,
            referenceDecision,
            referenceChecks,
            providerId,
            selectedModelIds,
            apiKey,
            defaultPromptTemplateText,
            defaultPromptTemplateId,
            executionConfig,
          )

    const response: EvaluationResponse = {
      caseData,
      referenceDecision,
      referenceChecks,
      results,
      metadata: isMockMode
        ? { evaluationMode: 'mock' }
        : {
            evaluationMode: 'live',
            providerId,
            providerLabel: getProviderLabel(providerId),
          },
    }

    return NextResponse.json(response)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
