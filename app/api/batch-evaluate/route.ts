import { NextResponse } from 'next/server'

import { benchmarkCases, type BenchmarkCase } from '@/lib/benchmark-cases'
import { parseLlmJson } from '@/lib/json-utils'
import { callProviderChatCompletion, type LlmProviderId } from '@/lib/llm-providers'
import type { PromptStrategyId } from '@/lib/openrouter'
import { deriveReferenceChecks, evaluateReferenceDecision } from '@/lib/pct-reference'
import { buildEvaluationPrompt } from '@/lib/prompt-builder'
import { normalizeLlmParsedOutput, scoreLlmOutput } from '@/lib/scoring'
import type {
  BenchmarkConfig,
  ClinicalCase,
  EvaluationWorkflow,
  LlmEvaluationResult,
  LlmParsedOutput,
  ModelFailureReason,
  PromptTemplate,
  ReferenceChecks,
  ReferenceDecision,
  RunControls,
  WorkflowType,
  WorkflowStep,
  WorkflowStepTrace,
} from '@/lib/types'

type PromptStrategy = 'Baseline Prompt' | 'Structured Prompt' | 'Verification Prompt'

type ProviderEvaluationConfig = {
  configId: string
  label: string
  configType?: 'model_only' | 'workflow'
  providerId: LlmProviderId
  workflowType: WorkflowType
  modelLabel: string
  modelId?: string
  modelIds: string[]
  promptStrategy: PromptStrategyId
  promptTemplateId?: string
  promptTemplateText?: string
  workflowId?: string
  workflow?: EvaluationWorkflow
  stepCount?: number
  toolAssisted?: boolean
}

type BatchEvaluateRequest = {
  providerId: LlmProviderId
  apiKey: string | null
  selectedModelIds: string[]
  benchmarkConfigs: ProviderEvaluationConfig[]
  evaluationConfigs: ProviderEvaluationConfig[]
  evaluationWorkflows: EvaluationWorkflow[]
  promptTemplates: PromptTemplate[]
  defaultPromptTemplateId?: string
  defaultPromptTemplateText?: string
  caseIds: string[]
  useMock: boolean
  runControls: RunControls
}

type BatchCaseResult = {
  caseId: string
  title: string
  sourceType: BenchmarkCase['sourceType']
  tags: string[]
  expectedReferenceLabel: BenchmarkCase['expectedReferenceLabel']
  caseData: ClinicalCase
  referenceDecision: ReferenceDecision
  referenceChecks: ReferenceChecks
  results: LlmEvaluationResult[]
}

const PROMPT_STRATEGIES: PromptStrategyId[] = ['baseline', 'structured', 'verification']
const DEFAULT_DELAY_MS = 2000
const DEFAULT_MAX_RETRIES = 2
const RETRY_BACKOFF_MS = [2000, 5000, 10000]
const DEFAULT_RUN_CONTROLS: RunControls = {
  delayBetweenCallsMs: DEFAULT_DELAY_MS,
  delayBetweenWorkflowStepsMs: DEFAULT_DELAY_MS,
  maxRetries: DEFAULT_MAX_RETRIES,
  retryBackoffMode: 'provider_hint',
  maxOutputTokens: 600,
  compactPromptMode: true,
  continueOnError: true,
  stopAfterFailureRatePercent: 100,
  maxCasesPerRun: 50,
  maxConfigsPerRun: 25,
}

const OPENROUTER_FALLBACK_CONFIGS: ProviderEvaluationConfig[] = [
  {
    configId: 'meta-llama-llama-3.2-3b-instruct-free_baseline',
    modelLabel: 'Llama 3.2 3B Instruct Free',
    modelId: 'meta-llama/llama-3.2-3b-instruct:free',
    label: 'Llama 3.2 3B Baseline',
    providerId: 'openrouter',
    workflowType: 'raw_baseline',
    modelIds: ['meta-llama/llama-3.2-3b-instruct:free'],
    promptStrategy: 'baseline',
  },
  {
    configId: 'google-gemma-3-4b-it-free_structured',
    modelLabel: 'Gemma 3 4B IT Free',
    modelId: 'google/gemma-3-4b-it:free',
    label: 'Gemma 3 Structured',
    providerId: 'openrouter',
    workflowType: 'structured_prompt',
    modelIds: ['google/gemma-3-4b-it:free'],
    promptStrategy: 'structured',
  },
  {
    configId: 'mistralai-mistral-7b-instruct-free_verification',
    modelLabel: 'Mistral 7B Instruct Free',
    modelId: 'mistralai/mistral-7b-instruct:free',
    label: 'Mistral Verification',
    providerId: 'openrouter',
    workflowType: 'verification',
    modelIds: ['mistralai/mistral-7b-instruct:free'],
    promptStrategy: 'verification',
  },
]

const GROQ_FALLBACK_CONFIGS: ProviderEvaluationConfig[] = [
  {
    configId: 'groq-llama-3.1-8b-instant_baseline',
    modelLabel: 'Llama 3.1 8B Instant',
    modelId: 'llama-3.1-8b-instant',
    label: 'Llama 3.1 Baseline',
    providerId: 'groq',
    workflowType: 'raw_baseline',
    modelIds: ['llama-3.1-8b-instant'],
    promptStrategy: 'baseline',
  },
  {
    configId: 'groq-gemma2-9b-it_structured',
    modelLabel: 'Gemma2 9B IT',
    modelId: 'gemma2-9b-it',
    label: 'Gemma2 Structured',
    providerId: 'groq',
    workflowType: 'structured_prompt',
    modelIds: ['gemma2-9b-it'],
    promptStrategy: 'structured',
  },
  {
    configId: 'groq-llama-3.3-70b-versatile_verification',
    modelLabel: 'Llama 3.3 70B Versatile',
    modelId: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 Verification',
    providerId: 'groq',
    workflowType: 'verification',
    modelIds: ['llama-3.3-70b-versatile'],
    promptStrategy: 'verification',
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseNumber(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.round(value), 0), max)
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function parseRunControls(body: Record<string, unknown>): RunControls {
  const raw = isRecord(body.runControls) ? body.runControls : {}
  const legacyDelayMs = parseNumber(body.delayMs, DEFAULT_RUN_CONTROLS.delayBetweenCallsMs, 60000)
  const legacyMaxRetries = parseNumber(body.maxRetries, DEFAULT_RUN_CONTROLS.maxRetries, 5)
  const retryBackoffMode =
    raw.retryBackoffMode === 'exponential' || raw.retryBackoffMode === 'provider_hint'
      ? raw.retryBackoffMode
      : DEFAULT_RUN_CONTROLS.retryBackoffMode

  return {
    delayBetweenCallsMs: parseNumber(raw.delayBetweenCallsMs, legacyDelayMs, 60000),
    delayBetweenWorkflowStepsMs: parseNumber(
      raw.delayBetweenWorkflowStepsMs,
      DEFAULT_RUN_CONTROLS.delayBetweenWorkflowStepsMs,
      60000,
    ),
    maxRetries: parseNumber(raw.maxRetries, legacyMaxRetries, 5),
    retryBackoffMode,
    maxOutputTokens: parseNumber(raw.maxOutputTokens, DEFAULT_RUN_CONTROLS.maxOutputTokens, 2000),
    compactPromptMode: parseBoolean(raw.compactPromptMode, DEFAULT_RUN_CONTROLS.compactPromptMode),
    continueOnError: parseBoolean(raw.continueOnError, DEFAULT_RUN_CONTROLS.continueOnError),
    stopAfterFailureRatePercent: parseNumber(
      raw.stopAfterFailureRatePercent,
      DEFAULT_RUN_CONTROLS.stopAfterFailureRatePercent,
      100,
    ),
    maxCasesPerRun: parseNumber(raw.maxCasesPerRun, DEFAULT_RUN_CONTROLS.maxCasesPerRun, 500),
    maxConfigsPerRun: parseNumber(raw.maxConfigsPerRun, DEFAULT_RUN_CONTROLS.maxConfigsPerRun, 100),
  }
}

function parseWorkflowType(value: unknown): WorkflowType {
  if (
    value === 'raw_baseline' ||
    value === 'structured_prompt' ||
    value === 'verification' ||
    value === 'deterministic_precheck_explanation'
  ) {
    return value
  }

  return 'structured_prompt'
}

function getPromptStrategyForWorkflow(workflowType: WorkflowType, fallback: unknown): PromptStrategyId {
  if (workflowType === 'raw_baseline') return 'baseline'
  if (workflowType === 'verification') return 'verification'
  if (workflowType === 'structured_prompt' || workflowType === 'deterministic_precheck_explanation') return 'structured'
  return fallback === 'baseline' || fallback === 'structured' || fallback === 'verification' ? fallback : 'structured'
}

function parseEvaluationConfigs(value: unknown, fallbackProviderId: LlmProviderId): ProviderEvaluationConfig[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isRecord)
    .map((rawConfig, index): ProviderEvaluationConfig | null => {
      const modelIds = Array.isArray(rawConfig.modelIds)
        ? rawConfig.modelIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).slice(0, 2)
        : []
      if (modelIds.length === 0) return null

      const workflowType = parseWorkflowType(rawConfig.workflowType)
      const providerId = rawConfig.providerId === 'groq' ? 'groq' : fallbackProviderId
      const label =
        typeof rawConfig.label === 'string' && rawConfig.label.trim()
          ? rawConfig.label.trim()
          : `${workflowType.replace(/_/g, ' ')} ${index + 1}`
      const configId =
        typeof rawConfig.configId === 'string' && rawConfig.configId.trim()
          ? rawConfig.configId.trim()
          : `${providerId}-${workflowType}-${index + 1}`

      return {
        configId: configId.replace(/[^a-zA-Z0-9._-]/g, '-'),
        label,
        configType: 'model_only',
        providerId,
        workflowType,
        modelLabel: label,
        modelIds,
        promptStrategy: getPromptStrategyForWorkflow(workflowType, rawConfig.promptStrategy),
        promptTemplateId: typeof rawConfig.promptTemplateId === 'string' ? rawConfig.promptTemplateId : undefined,
        promptTemplateText: typeof rawConfig.promptTemplateText === 'string' ? rawConfig.promptTemplateText : undefined,
      }
    })
    .filter((config): config is ProviderEvaluationConfig => config !== null)
    .slice(0, 5)
}

function getPromptStrategyForTemplateId(templateId: unknown, fallback: PromptStrategyId = 'baseline'): PromptStrategyId {
  if (typeof templateId !== 'string') return fallback
  const lower = templateId.toLowerCase()
  if (lower.includes('verification') || lower.includes('a4-final')) return 'verification'
  if (lower.includes('structured') || lower.includes('json') || lower.includes('a2-') || lower.includes('a3-')) {
    return 'structured'
  }
  return fallback
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
  const inputSource = value.inputSource
  if (
    inputSource !== 'case_data' &&
    inputSource !== 'previous_step' &&
    inputSource !== 'reference_checks' &&
    inputSource !== 'combined'
  ) {
    return null
  }

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id : `step-${Date.now()}`,
    name: typeof value.name === 'string' && value.name.trim() ? value.name : stepType,
    stepType,
    modelId: typeof value.modelId === 'string' && value.modelId.trim() ? value.modelId : undefined,
    promptTemplateId:
      typeof value.promptTemplateId === 'string' && value.promptTemplateId.trim() ? value.promptTemplateId : undefined,
    promptTemplateText:
      typeof value.promptTemplateText === 'string' && value.promptTemplateText.trim()
        ? value.promptTemplateText
        : undefined,
    inputSource,
  }
}

function parseEvaluationWorkflows(value: unknown): EvaluationWorkflow[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isRecord)
    .map((rawWorkflow, index): EvaluationWorkflow | null => {
      const steps = Array.isArray(rawWorkflow.steps)
        ? rawWorkflow.steps.map(parseWorkflowStep).filter((step): step is WorkflowStep => step !== null).slice(0, 5)
        : []
      if (steps.length === 0) return null

      return {
        id:
          typeof rawWorkflow.id === 'string' && rawWorkflow.id.trim()
            ? rawWorkflow.id.replace(/[^a-zA-Z0-9._-]/g, '-')
            : `workflow-${index + 1}`,
        name:
          typeof rawWorkflow.name === 'string' && rawWorkflow.name.trim()
            ? rawWorkflow.name.trim()
            : `Workflow ${index + 1}`,
        description:
          typeof rawWorkflow.description === 'string' && rawWorkflow.description.trim()
            ? rawWorkflow.description.trim()
            : 'Custom evaluation workflow',
        steps,
        isDefault: rawWorkflow.isDefault === true,
      }
    })
    .filter((workflow): workflow is EvaluationWorkflow => workflow !== null)
    .slice(0, 5)
}

function parsePromptTemplates(value: unknown): PromptTemplate[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isRecord)
    .map((rawTemplate): PromptTemplate | null => {
      if (
        typeof rawTemplate.id !== 'string' ||
        typeof rawTemplate.name !== 'string' ||
        typeof rawTemplate.description !== 'string' ||
        typeof rawTemplate.text !== 'string'
      ) {
        return null
      }

      const expectedOutputSchema = rawTemplate.expectedOutputSchema
      if (
        expectedOutputSchema !== 'pct_json' &&
        expectedOutputSchema !== 'free_text' &&
        expectedOutputSchema !== 'verification_json'
      ) {
        return null
      }

      return {
        id: rawTemplate.id,
        name: rawTemplate.name,
        description: rawTemplate.description,
        text: rawTemplate.text,
        expectedOutputSchema,
        isDefault: rawTemplate.isDefault === true,
        updatedAt: typeof rawTemplate.updatedAt === 'string' ? rawTemplate.updatedAt : new Date().toISOString(),
      }
    })
    .filter((template): template is PromptTemplate => template !== null)
}

function hydrateWorkflowPromptTemplates(
  workflows: EvaluationWorkflow[],
  promptTemplates: PromptTemplate[],
): EvaluationWorkflow[] {
  if (promptTemplates.length === 0) return workflows
  const templateTextById = new Map(promptTemplates.map((template) => [template.id, template.text]))

  return workflows.map((workflow) => ({
    ...workflow,
    steps: workflow.steps.map((step) => ({
      ...step,
      promptTemplateText:
        step.promptTemplateText ?? (step.promptTemplateId ? templateTextById.get(step.promptTemplateId) : undefined),
    })),
  }))
}

function parseBenchmarkConfigs(value: unknown, fallbackProviderId: LlmProviderId): ProviderEvaluationConfig[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isRecord)
    .map((rawConfig, index): ProviderEvaluationConfig | null => {
      const candidate = rawConfig as Partial<BenchmarkConfig>
      const providerId = candidate.providerId === 'groq' ? 'groq' : fallbackProviderId
      const configId =
        typeof candidate.configId === 'string' && candidate.configId.trim()
          ? candidate.configId.trim().replace(/[^a-zA-Z0-9._-]/g, '-')
          : `benchmark-config-${index + 1}`
      const label =
        typeof candidate.label === 'string' && candidate.label.trim()
          ? candidate.label.trim()
          : `Benchmark config ${index + 1}`

      if (candidate.configType === 'workflow') {
        const [workflow] = parseEvaluationWorkflows(candidate.workflow ? [candidate.workflow] : [])
        if (!workflow) return null
        const hydratedWorkflow = hydrateWorkflowPromptTemplates([workflow], [])[0] ?? workflow
        const modelIds = getModelIdsForWorkflow(hydratedWorkflow)
        const workflowType = getWorkflowTypeForWorkflow(hydratedWorkflow)

        return {
          configId,
          label,
          configType: 'workflow',
          providerId,
          workflowType,
          modelLabel: modelIds.join(' + ') || hydratedWorkflow.name,
          modelIds,
          promptStrategy: getPromptStrategyForWorkflow(workflowType, 'structured'),
          workflowId: typeof candidate.workflowId === 'string' ? candidate.workflowId : hydratedWorkflow.id,
          workflow: hydratedWorkflow,
          stepCount:
            typeof candidate.stepCount === 'number' && Number.isFinite(candidate.stepCount)
              ? Math.max(0, Math.round(candidate.stepCount))
              : hydratedWorkflow.steps.length,
          toolAssisted: candidate.toolAssisted === true || isToolAssistedWorkflow(hydratedWorkflow),
        }
      }

      const modelId = typeof candidate.modelId === 'string' && candidate.modelId.trim() ? candidate.modelId.trim() : ''
      if (!modelId) return null
      const promptStrategy = getPromptStrategyForTemplateId(candidate.promptTemplateId)

      return {
        configId,
        label,
        configType: 'model_only',
        providerId,
        workflowType: promptStrategy === 'structured' ? 'structured_prompt' : promptStrategy === 'verification' ? 'verification' : 'raw_baseline',
        modelLabel: modelId,
        modelId,
        modelIds: [modelId],
        promptStrategy,
        promptTemplateId: typeof candidate.promptTemplateId === 'string' ? candidate.promptTemplateId : undefined,
        promptTemplateText: typeof candidate.promptTemplateText === 'string' ? candidate.promptTemplateText : undefined,
        stepCount:
          typeof candidate.stepCount === 'number' && Number.isFinite(candidate.stepCount)
            ? Math.max(0, Math.round(candidate.stepCount))
            : 1,
        toolAssisted: false,
      }
    })
    .filter((config): config is ProviderEvaluationConfig => config !== null)
    .slice(0, 25)
}

function parseRequestBody(body: unknown): BatchEvaluateRequest {
  if (!isRecord(body)) {
    return {
      providerId: 'openrouter',
      apiKey: null,
      selectedModelIds: [],
      benchmarkConfigs: [],
      evaluationConfigs: [],
      evaluationWorkflows: [],
      promptTemplates: [],
      defaultPromptTemplateId: undefined,
      defaultPromptTemplateText: undefined,
      caseIds: [],
      useMock: false,
      runControls: DEFAULT_RUN_CONTROLS,
    }
  }

  return {
    providerId: body.providerId === 'groq' ? 'groq' : 'openrouter',
    apiKey: typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : null,
    selectedModelIds: Array.isArray(body.selectedModelIds)
      ? body.selectedModelIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [],
    benchmarkConfigs: parseBenchmarkConfigs(body.benchmarkConfigs, body.providerId === 'groq' ? 'groq' : 'openrouter'),
    evaluationConfigs: parseEvaluationConfigs(body.evaluationConfigs, body.providerId === 'groq' ? 'groq' : 'openrouter'),
    evaluationWorkflows: parseEvaluationWorkflows(body.evaluationWorkflows),
    promptTemplates: parsePromptTemplates(body.promptTemplates),
    defaultPromptTemplateId:
      typeof body.defaultPromptTemplateId === 'string' && body.defaultPromptTemplateId.trim()
        ? body.defaultPromptTemplateId.trim()
        : undefined,
    defaultPromptTemplateText:
      typeof body.defaultPromptTemplateText === 'string' && body.defaultPromptTemplateText.trim()
        ? body.defaultPromptTemplateText
        : undefined,
    caseIds: Array.isArray(body.caseIds)
      ? body.caseIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [],
    useMock: body.useMock === true,
    runControls: parseRunControls(body),
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown provider error')
}

class RetryTrackingError extends Error {
  retryCount: number

  constructor(error: unknown, retryCount: number) {
    super(getErrorMessage(error))
    this.name = 'RetryTrackingError'
    this.retryCount = retryCount
  }
}

class WorkflowStepExecutionError extends Error {
  failedStepName: string
  failedStepIndex: number
  retryCount: number
  workflowTrace?: WorkflowStepTrace[]

  constructor(
    error: unknown,
    failedStepName: string,
    failedStepIndex: number,
    retryCount: number,
    workflowTrace?: WorkflowStepTrace[],
  ) {
    super(getErrorMessage(error))
    this.name = 'WorkflowStepExecutionError'
    this.failedStepName = failedStepName
    this.failedStepIndex = failedStepIndex
    this.retryCount = retryCount
    this.workflowTrace = workflowTrace
  }
}

function getRetryCount(error: unknown): number {
  if (error instanceof WorkflowStepExecutionError) return error.retryCount
  return error instanceof RetryTrackingError ? error.retryCount : 0
}

function getFailedStepName(error: unknown): string | undefined {
  return error instanceof WorkflowStepExecutionError ? error.failedStepName : undefined
}

function getFailedStepIndex(error: unknown): number | undefined {
  return error instanceof WorkflowStepExecutionError ? error.failedStepIndex : undefined
}

function getWorkflowTrace(error: unknown): WorkflowStepTrace[] | undefined {
  return error instanceof WorkflowStepExecutionError ? error.workflowTrace : undefined
}

function isRateLimitError(error: unknown): boolean {
  const message = getErrorMessage(error)
  const lower = message.toLowerCase()

  return (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    message.includes('TPM') ||
    lower.includes('tokens per minute') ||
    lower.includes('too many requests')
  )
}

function parseProviderRetryDelayMs(message: string): number | null {
  const match = message.match(/(?:please\s+)?try again in\s+(\d+(?:\.\d+)?)s/i)
  if (!match) return null

  const seconds = Number(match[1])
  if (!Number.isFinite(seconds)) return null

  return Math.ceil(seconds * 1000) + 500
}

async function callWithRetry<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; baseDelayMs?: number; retryBackoffMode?: RunControls['retryBackoffMode'] },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_DELAY_MS
  const retryBackoffMode = options?.retryBackoffMode ?? 'provider_hint'
  let retryCount = 0

  while (true) {
    try {
      return await fn()
    } catch (error) {
      if (!isRateLimitError(error) || retryCount >= maxRetries) {
        throw new RetryTrackingError(error, retryCount)
      }

      const message = getErrorMessage(error)
      const retryDelayMs =
        (retryBackoffMode === 'provider_hint' ? parseProviderRetryDelayMs(message) : null) ??
        (retryCount === 0 ? baseDelayMs : RETRY_BACKOFF_MS[Math.min(retryCount, RETRY_BACKOFF_MS.length - 1)])

      retryCount += 1
      await sleep(retryDelayMs)
    }
  }
}

function classifyModelFailure(error: unknown): ModelFailureReason {
  const message = getErrorMessage(error)
  const lower = message.toLowerCase()

  if (isRateLimitError(error)) return 'rate_limited'
  if (lower.includes('invalid api key') || lower.includes('unauthorized') || lower.includes('401') || lower.includes('403')) {
    return 'invalid_key'
  }
  if (lower.includes('insufficient credits') || lower.includes('no credits') || lower.includes('credits')) {
    return 'needs_credits'
  }
  if (lower.includes('model not found')) {
    return 'model_not_found'
  }
  if (lower.includes('no endpoint') || lower.includes('no endpoints')) {
    return 'no_endpoint'
  }
  if (lower.includes('not found') || lower.includes('404')) return 'model_not_found'
  if (lower.includes('provider returned error') || lower.includes('provider error')) {
    return 'provider_error'
  }

  return 'unknown'
}

function getReadableModelError(error: unknown, failureReason: ModelFailureReason): string {
  if (failureReason === 'rate_limited') {
    return 'Rate limit reached. Retry later, reduce selected models/cases, or increase delay.'
  }

  return getErrorMessage(error)
}

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

function getFallbackProviderConfigs(providerId: LlmProviderId): ProviderEvaluationConfig[] {
  return providerId === 'groq' ? GROQ_FALLBACK_CONFIGS : OPENROUTER_FALLBACK_CONFIGS
}

function buildProviderConfigs(
  providerId: LlmProviderId,
  selectedModelIds: string[],
  defaultPromptTemplateText?: string,
  defaultPromptTemplateId?: string,
): ProviderEvaluationConfig[] {
  const uniqueModelIds = Array.from(new Set(selectedModelIds.map((id) => id.trim()).filter(Boolean))).slice(0, 3)

  if (uniqueModelIds.length === 0) {
    return getFallbackProviderConfigs(providerId).map((config) => ({
      ...config,
      configType: 'model_only',
      promptTemplateId: defaultPromptTemplateId ?? config.promptTemplateId,
      promptTemplateText: defaultPromptTemplateText ?? config.promptTemplateText,
    }))
  }

  return uniqueModelIds.map((modelId, index) => ({
    configId: `${modelId}_${PROMPT_STRATEGIES[index]}`.replace(/[^a-zA-Z0-9._-]/g, '-'),
    label: `${modelId} ${PROMPT_STRATEGIES[index]}`,
    configType: 'model_only',
    providerId,
    workflowType:
      PROMPT_STRATEGIES[index] === 'baseline'
        ? 'raw_baseline'
        : PROMPT_STRATEGIES[index] === 'verification'
          ? 'verification'
          : 'structured_prompt',
    modelLabel: modelId,
    modelId,
    modelIds: [modelId],
    promptStrategy: defaultPromptTemplateText ? 'baseline' : PROMPT_STRATEGIES[index],
    promptTemplateId: defaultPromptTemplateId,
    promptTemplateText: defaultPromptTemplateText,
  }))
}

function getWorkflowTypeForWorkflow(workflow: EvaluationWorkflow): WorkflowType {
  if (workflow.steps.some((step) => step.stepType === 'deterministic_precheck')) {
    return 'deterministic_precheck_explanation'
  }
  if (workflow.steps.some((step) => step.stepType === 'verification')) return 'verification'
  if (workflow.steps.some((step) => step.promptTemplateId?.includes('baseline'))) return 'raw_baseline'
  return 'structured_prompt'
}

function isToolAssistedWorkflow(workflow?: EvaluationWorkflow): boolean {
  return workflow?.steps.some((step) => step.stepType === 'deterministic_precheck') ?? false
}

function isToolAssistedConfig(config: ProviderEvaluationConfig): boolean {
  return config.workflowType === 'deterministic_precheck_explanation' || isToolAssistedWorkflow(config.workflow)
}

function getPromptStrategyForStep(step: WorkflowStep): PromptStrategyId {
  if (step.stepType === 'verification' || step.stepType === 'final_report') return 'verification'
  if (step.promptTemplateId?.includes('baseline')) return 'baseline'
  if (step.promptTemplateId?.includes('verification')) return 'verification'
  return 'structured'
}

function getModelIdsForWorkflow(workflow: EvaluationWorkflow): string[] {
  return Array.from(
    new Set(
      workflow.steps
        .map((step) => step.modelId)
        .filter((modelId): modelId is string => typeof modelId === 'string' && modelId.trim().length > 0),
    ),
  )
}

function buildWorkflowConfigs(providerId: LlmProviderId, workflows: EvaluationWorkflow[]): ProviderEvaluationConfig[] {
  return workflows.map((workflow) => {
    const modelIds = getModelIdsForWorkflow(workflow)
    const workflowType = getWorkflowTypeForWorkflow(workflow)

    return {
      configId: workflow.id,
      label: workflow.name,
      configType: 'workflow',
      providerId,
      workflowType,
      modelLabel: modelIds.join(' + ') || workflow.name,
      modelIds,
      promptStrategy: getPromptStrategyForWorkflow(workflowType, 'structured'),
      workflow,
      workflowId: workflow.id,
      stepCount: workflow.steps.length,
      toolAssisted: isToolAssistedWorkflow(workflow),
    }
  })
}

function buildMockParsedOutput(
  caseData: ClinicalCase,
  referenceDecision: ReferenceDecision,
  referenceChecks: ReferenceChecks,
): LlmParsedOutput {
  const missingInformation: string[] = []
  if (caseData.currentPct === null) missingInformation.push('currentPct')
  if (caseData.peakPct === null) missingInformation.push('peakPct')
  if (caseData.clinicalImprovement === 'unclear') missingInformation.push('clinicalImprovement')
  if (caseData.infectionContext === 'other_or_unclear') missingInformation.push('infectionContext')

  const safetyWarnings =
    caseData.exclusionCondition === 'none'
      ? []
      : [`Exclusion or caution condition present: ${caseData.exclusionCondition}.`]

  return {
    recommendation: referenceDecision.recommendation,
    absolute_threshold_met: referenceChecks.absoluteThresholdMet,
    pct_decline_threshold_met: referenceChecks.pctDeclineCriterionMet,
    clinical_improvement_required: true,
    clinical_improvement_present: referenceChecks.clinicalImprovementPresent,
    exclusion_condition_present: referenceChecks.exclusionConditionPresent,
    safety_gate_passed: referenceChecks.discontinuationGatePassed,
    calculation_audit: {
      current_pct: caseData.currentPct,
      threshold_used: referenceDecision.thresholdUsed,
      current_pct_less_or_equal_threshold: referenceChecks.absoluteThresholdMet,
      peak_pct: caseData.peakPct,
      pct_decline_percent: referenceDecision.pctDeclinePercent,
      pct_decline_greater_than_80: referenceChecks.pctDeclineCriterionMet,
    },
    pct_interpretation:
      referenceDecision.thresholdUsed === null
        ? 'No absolute PCT threshold applies for this infection context.'
        : `Current PCT compared with threshold ${referenceDecision.thresholdUsed} ng/mL; decline from peak is ${
            referenceDecision.pctDeclinePercent === null
              ? 'not available'
              : `${referenceDecision.pctDeclinePercent.toFixed(1)}%`
          }.`,
    threshold_used: referenceDecision.thresholdUsed,
    pct_decline_calculated: referenceDecision.pctDeclinePercent,
    reasoning_summary:
      'Mock batch output mirrors deterministic benchmark checks for reference pipeline validation.',
    safety_warnings: safetyWarnings,
    missing_information: missingInformation,
    confidence: 'high',
  }
}

function buildMockResult(
  config: ProviderEvaluationConfig,
  caseData: ClinicalCase,
  referenceDecision: ReferenceDecision,
  referenceChecks: ReferenceChecks,
): LlmEvaluationResult {
  const parsedOutput = buildMockParsedOutput(caseData, referenceDecision, referenceChecks)

  return {
    configId: config.configId,
    modelLabel: config.modelLabel,
    configLabel: config.label,
    configType: config.configType,
    workflowType: config.workflowType,
    workflowName: config.workflow?.name,
    workflowStepCount: config.stepCount ?? config.workflow?.steps.length,
    toolAssisted: config.toolAssisted ?? isToolAssistedConfig(config),
    promptStrategy: getPromptStrategyLabel(config.promptStrategy),
    status: 'success',
    parsedOutput,
    rawOutput: JSON.stringify(parsedOutput, null, 2),
    scores: scoreLlmOutput(parsedOutput, referenceDecision, caseData, referenceChecks),
  }
}

function getPrimaryModelId(config: ProviderEvaluationConfig): string {
  return config.modelIds[0] ?? config.modelId ?? config.modelLabel
}

function getVerifierModelId(config: ProviderEvaluationConfig): string {
  return config.modelIds[1] ?? getPrimaryModelId(config)
}

function buildDeterministicPrecheckPrompt(
  caseData: ClinicalCase,
  referenceDecision: ReferenceDecision,
  referenceChecks: ReferenceChecks,
  promptTemplateText?: string,
): string {
  return `${buildEvaluationPrompt(caseData, 'structured', promptTemplateText)}

Tool-assisted deterministic precheck:
- This workflow is deterministic_precheck_explanation. It is not raw model reasoning.
- The backend has already computed the PCT rule proxy result.
- Explain the deterministic result faithfully and return only the required JSON schema.

Backend-computed rule result:
recommendation: ${referenceDecision.recommendation}
threshold_used: ${referenceDecision.thresholdUsed ?? 'null'}
pct_decline_percent: ${referenceDecision.pctDeclinePercent ?? 'null'}
absolute_threshold_met: ${referenceChecks.absoluteThresholdMet ?? 'null'}
pct_decline_threshold_met: ${referenceChecks.pctDeclineCriterionMet ?? 'null'}
clinical_improvement_present: ${referenceChecks.clinicalImprovementPresent}
exclusion_condition_present: ${referenceChecks.exclusionConditionPresent}
discontinuation_gate_passed: ${referenceChecks.discontinuationGatePassed ?? 'null'}
explanation: ${referenceDecision.explanation}`
}

function buildVerifierPrompt(caseData: ClinicalCase, primaryOutput: string, promptTemplateText?: string): string {
  return `${buildEvaluationPrompt(caseData, 'verification', promptTemplateText)}

Verifier workflow:
- Review the primary model output below.
- Re-check the structured criteria against the case data and PCT rules.
- Return the corrected final JSON only.

Primary model output:
${primaryOutput}`
}

function formatReferenceChecksContext(referenceChecks: ReferenceChecks): string {
  return JSON.stringify({ referenceChecks }, null, 2)
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
    .map((output, index) => {
      return `Step ${index + 1} (${output.stepName}, ${output.stepId}):\n${output.output}`
    })
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
  const caseContext = JSON.stringify(caseData, null, 2)
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
      prompt: `Deterministic reference checks:\n${formatReferenceChecksContext(referenceChecks)}`,
      summary: 'Deterministic reference checks only.',
      previousStepOutputIncluded: false,
      includedStepOutputIds: [],
      referenceChecksIncluded: true,
    }
  }

  if (step.inputSource === 'combined') {
    return {
      prompt: `Case data:\n${caseContext}\n\nPrevious workflow step outputs:\n${formatWorkflowStepOutputs(stepOutputs)}`,
      summary: `Case data plus ${stepOutputs.length} previous step output${stepOutputs.length === 1 ? '' : 's'}.`,
      previousStepOutputIncluded: stepOutputs.length > 0,
      includedStepOutputIds: stepOutputs.map((output) => output.stepId),
      referenceChecksIncluded: deterministicOutputIncluded,
    }
  }

  return {
    prompt: `Case data:\n${caseContext}`,
    summary: 'Original case data and case context only.',
    previousStepOutputIncluded: false,
    includedStepOutputIds: [],
    referenceChecksIncluded: false,
  }
}

function buildStepPrompt(args: {
  step: WorkflowStep
  caseData: ClinicalCase
  referenceChecks: ReferenceChecks
  stepIndex: number
  stepOutputs: WorkflowStepOutput[]
}): string {
  const { step, caseData, referenceChecks, stepIndex, stepOutputs } = args
  const promptStrategy = getPromptStrategyForStep(step)
  const basePrompt = buildEvaluationPrompt(caseData, promptStrategy, step.promptTemplateText)
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
  runControls: RunControls
}): Promise<{ finalRawOutput: string; rawOutput: string; trace: WorkflowStepTrace[] }> {
  const { providerId, apiKey, config, caseData, referenceChecks, runControls } = args
  const workflow = config.workflow
  if (!workflow) {
    throw new Error('Workflow config missing workflow definition')
  }

  let previousOutput = ''
  const stepOutputs: WorkflowStepOutput[] = []
  const trace: WorkflowStepTrace[] = []

  for (const [index, step] of workflow.steps.entries()) {
    if (stepOutputs.length > 0 && runControls.delayBetweenWorkflowStepsMs > 0) {
      await sleep(runControls.delayBetweenWorkflowStepsMs)
    }

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
        resolvedInputSummary: getErrorMessage(error),
        previousStepOutputIncluded: false,
        includedStepOutputIds: [],
        referenceChecksIncluded: false,
        parsedSuccessfully: false,
        error: getErrorMessage(error),
      }
      throw new WorkflowStepExecutionError(error, step.name, index, 0, [...trace, failedTrace])
    }

    if (step.stepType === 'deterministic_precheck') {
      previousOutput = formatReferenceChecksContext(referenceChecks)
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

    const modelId = step.modelId || getPrimaryModelId(config)
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
      throw new WorkflowStepExecutionError(error, step.name, index, 0, [...trace, failedTrace])
    }

    try {
      previousOutput = await callWithRetry(
        () =>
          callProviderChatCompletion(
            config.providerId ?? providerId,
            apiKey,
            modelId,
            [
              {
                role: 'user',
                content: buildStepPrompt({ step, caseData, referenceChecks, stepIndex: index, stepOutputs }),
              },
            ],
            { temperature: 0.1, max_tokens: runControls.maxOutputTokens },
          ),
        {
          maxRetries: runControls.maxRetries,
          baseDelayMs: runControls.delayBetweenCallsMs,
          retryBackoffMode: runControls.retryBackoffMode,
        },
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
        error: getErrorMessage(error),
      }
      throw new WorkflowStepExecutionError(error, step.name, index, getRetryCount(error), [...trace, failedTrace])
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

async function buildLiveResult(args: {
  providerId: LlmProviderId
  apiKey: string | null
  config: ProviderEvaluationConfig
  caseData: ClinicalCase
  referenceDecision: ReferenceDecision
  referenceChecks: ReferenceChecks
  runControls: RunControls
}): Promise<LlmEvaluationResult> {
  const { providerId, apiKey, config, caseData, referenceDecision, referenceChecks, runControls } = args
  const promptStrategy = getPromptStrategyLabel(config.promptStrategy)
  const primaryModelId = getPrimaryModelId(config)

  if (!apiKey) {
    return {
      configId: config.configId,
      modelLabel: config.modelLabel,
      configLabel: config.label,
      configType: config.configType,
      workflowType: config.workflowType,
      workflowName: config.workflow?.name,
      workflowStepCount: config.stepCount ?? config.workflow?.steps.length,
      toolAssisted: config.toolAssisted ?? isToolAssistedConfig(config),
      promptStrategy,
      status: 'error',
      error: 'No API key connected for selected provider.',
      failureReason: 'invalid_key',
      retryCount: 0,
    }
  }

  const workflowExecution = config.workflow
    ? await executeWorkflow({
        providerId,
        apiKey,
        config,
        caseData,
        referenceDecision,
        referenceChecks,
        runControls,
      })
    : null

  const rawOutput =
    workflowExecution?.finalRawOutput ??
    (await callWithRetry(
      () =>
        callProviderChatCompletion(
          config.providerId ?? providerId,
          apiKey,
          primaryModelId,
          [
            {
              role: 'user',
              content:
                config.workflowType === 'deterministic_precheck_explanation'
                  ? buildDeterministicPrecheckPrompt(
                      caseData,
                      referenceDecision,
                      referenceChecks,
                      config.promptTemplateText,
                    )
                  : buildEvaluationPrompt(caseData, config.promptStrategy, config.promptTemplateText),
            },
          ],
          { temperature: 0.1, max_tokens: runControls.maxOutputTokens },
        ),
      {
        maxRetries: runControls.maxRetries,
        baseDelayMs: runControls.delayBetweenCallsMs,
        retryBackoffMode: runControls.retryBackoffMode,
      },
    ))

  let finalRawOutput = rawOutput
  if (!config.workflow && config.workflowType === 'verification') {
    if (runControls.delayBetweenWorkflowStepsMs > 0) await sleep(runControls.delayBetweenWorkflowStepsMs)
    finalRawOutput = await callWithRetry(
      () =>
        callProviderChatCompletion(
          config.providerId ?? providerId,
          apiKey,
          getVerifierModelId(config),
              [{ role: 'user', content: buildVerifierPrompt(caseData, rawOutput, config.promptTemplateText) }],
          { temperature: 0.1, max_tokens: runControls.maxOutputTokens },
        ),
      {
        maxRetries: runControls.maxRetries,
        baseDelayMs: runControls.delayBetweenCallsMs,
        retryBackoffMode: runControls.retryBackoffMode,
      },
    )
  }

  const parsedJson = parseLlmJson(finalRawOutput)
  if (!parsedJson.ok) {
    return {
      configId: config.configId,
      modelLabel: config.modelLabel,
      configLabel: config.label,
      configType: config.configType,
      workflowType: config.workflowType,
      workflowName: config.workflow?.name,
      workflowStepCount: config.stepCount ?? config.workflow?.steps.length,
      toolAssisted: config.toolAssisted ?? isToolAssistedConfig(config),
      promptStrategy,
      status: 'error',
      rawOutput: finalRawOutput,
      error: `Could not parse valid JSON: ${parsedJson.error}`,
      failureReason: 'unknown',
      retryCount: 0,
      workflowTrace: workflowExecution?.trace,
    }
  }

  const parsedOutput = normalizeLlmParsedOutput(parsedJson.data)
  if (!parsedOutput) {
    return {
      configId: config.configId,
      modelLabel: config.modelLabel,
      configLabel: config.label,
      configType: config.configType,
      workflowType: config.workflowType,
      workflowName: config.workflow?.name,
      workflowStepCount: config.stepCount ?? config.workflow?.steps.length,
      toolAssisted: config.toolAssisted ?? isToolAssistedConfig(config),
      promptStrategy,
      status: 'error',
      rawOutput: finalRawOutput,
      error: 'Model JSON did not match the required evaluation schema',
      failureReason: 'unknown',
      retryCount: 0,
      workflowTrace: workflowExecution?.trace,
    }
  }

  return {
    configId: config.configId,
    modelLabel: config.modelLabel,
    configLabel: config.label,
    configType: config.configType,
    workflowType: config.workflowType,
    promptStrategy,
    status: 'success',
    parsedOutput,
    workflowName: config.workflow?.name,
    workflowStepCount: config.stepCount ?? config.workflow?.steps.length,
    toolAssisted: config.toolAssisted ?? isToolAssistedConfig(config),
    rawOutput: workflowExecution?.rawOutput ?? (config.workflowType === 'verification'
      ? JSON.stringify({ primaryOutput: rawOutput, verifierOutput: finalRawOutput }, null, 2)
      : finalRawOutput),
    workflowTrace: workflowExecution?.trace,
    scores: scoreLlmOutput(parsedOutput, referenceDecision, caseData, referenceChecks),
  }
}

async function evaluateCase(args: {
  benchmarkCase: BenchmarkCase
  providerId: LlmProviderId
  apiKey: string | null
  configs: ProviderEvaluationConfig[]
  useMock: boolean
  runControls: RunControls
  delayBeforeFirstModel: boolean
}): Promise<BatchCaseResult> {
  const { benchmarkCase, providerId, apiKey, configs, useMock, runControls, delayBeforeFirstModel } = args
  const referenceDecision = evaluateReferenceDecision(benchmarkCase.caseData)
  const referenceChecks = deriveReferenceChecks(benchmarkCase.caseData, referenceDecision)

  const results: LlmEvaluationResult[] = []

  for (const config of configs) {
    if ((results.length > 0 || delayBeforeFirstModel) && runControls.delayBetweenCallsMs > 0) {
      await sleep(runControls.delayBetweenCallsMs)
    }

    try {
      const result = useMock
        ? buildMockResult(config, benchmarkCase.caseData, referenceDecision, referenceChecks)
        : await buildLiveResult({
            providerId,
            apiKey,
            config,
            caseData: benchmarkCase.caseData,
            referenceDecision,
            referenceChecks,
            runControls,
          })

      results.push(result)
    } catch (error) {
      const failureReason = classifyModelFailure(error)
      const retryCount = getRetryCount(error)
      const errorResult: LlmEvaluationResult = {
        configId: config.configId,
        modelLabel: config.modelLabel,
        configLabel: config.label,
        configType: config.configType,
        workflowType: config.workflowType,
        workflowName: config.workflow?.name,
        workflowStepCount: config.stepCount ?? config.workflow?.steps.length,
        toolAssisted: config.toolAssisted ?? isToolAssistedConfig(config),
        promptStrategy: getPromptStrategyLabel(config.promptStrategy),
        status: 'error',
        error: getReadableModelError(error, failureReason),
        failureReason,
        retryCount,
        failedStepName: getFailedStepName(error),
        failedStepIndex: getFailedStepIndex(error),
        workflowTrace: getWorkflowTrace(error),
      }

      results.push(errorResult)
      if (!runControls.continueOnError) {
        break
      }
    }
  }

  return {
    caseId: benchmarkCase.id,
    title: benchmarkCase.title,
    sourceType: benchmarkCase.sourceType,
    tags: benchmarkCase.tags,
    expectedReferenceLabel: benchmarkCase.expectedReferenceLabel,
    caseData: benchmarkCase.caseData,
    referenceDecision,
    referenceChecks,
    results,
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function buildAggregate(caseResults: BatchCaseResult[]) {
  const allResults = caseResults.flatMap((caseResult) => caseResult.results)
  const successfulResults = allResults.filter((result) => result.status === 'success' && result.scores)
  const failedResults = allResults.filter((result) => result.status === 'error')
  const totalSafetyWarnings = allResults.reduce(
    (sum, result) => sum + (result.parsedOutput?.safety_warnings.length ?? 0),
    0,
  )

  return {
    averageRecommendationMatch: average(successfulResults.map((result) => result.scores?.recommendationMatch ?? 0)),
    averageCriterionAlignment: average(successfulResults.map((result) => result.scores?.alignment ?? 0)),
    averageSafety: average(successfulResults.map((result) => result.scores?.safety ?? 0)),
    averageExplainability: average(successfulResults.map((result) => result.scores?.explainability ?? 0)),
    totalSafetyWarnings,
    failedModelCalls: failedResults.length,
  }
}

function countEstimatedCalls(configs: ProviderEvaluationConfig[], caseCount: number): number {
  const callsPerCase = configs.reduce((sum, config) => {
    if (config.workflow) {
      return sum + config.workflow.steps.filter((step) => step.stepType !== 'deterministic_precheck' && !!step.modelId).length
    }
    return sum + (config.workflowType === 'verification' ? 2 : 1)
  }, 0)

  return callsPerCase * caseCount
}

function getEstimatedRiskLevel(estimatedCalls: number, runControls: RunControls): 'low' | 'medium' | 'high' {
  if (estimatedCalls > 80 || runControls.delayBetweenCallsMs < 1000) return 'high'
  if (estimatedCalls > 30 || runControls.delayBetweenCallsMs < 2000) return 'medium'
  return 'low'
}

export async function POST(request: Request) {
  let input: BatchEvaluateRequest

  try {
    input = parseRequestBody(await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const allSelectedCases =
    input.caseIds.length > 0
      ? benchmarkCases.filter((benchmarkCase) => input.caseIds.includes(benchmarkCase.id))
      : benchmarkCases
  const selectedCases = allSelectedCases.slice(0, input.runControls.maxCasesPerRun)

  const allConfigs =
    input.benchmarkConfigs.length > 0
      ? input.benchmarkConfigs
    : input.evaluationWorkflows.length > 0
      ? buildWorkflowConfigs(
          input.providerId,
          hydrateWorkflowPromptTemplates(input.evaluationWorkflows, input.promptTemplates),
        )
      : input.evaluationConfigs.length > 0
      ? input.evaluationConfigs
      : buildProviderConfigs(
          input.providerId,
          input.selectedModelIds,
          input.defaultPromptTemplateText,
          input.defaultPromptTemplateId,
        )
  const configs = allConfigs.slice(0, input.runControls.maxConfigsPerRun)
  const selectedModelCount = new Set(input.selectedModelIds.map((id) => id.trim()).filter(Boolean)).size
  const workflowConfigCount = configs.filter((config) => config.configType === 'workflow').length
  const modelOnlyConfigCount = configs.filter((config) => config.configType !== 'workflow').length
  const totalConfigCount = configs.length
  const estimatedCalls = countEstimatedCalls(configs, selectedCases.length)
  const estimatedRiskLevel = getEstimatedRiskLevel(estimatedCalls, input.runControls)
  const caseResults: BatchCaseResult[] = []

  for (const benchmarkCase of selectedCases) {
    const caseResult = await evaluateCase({
      benchmarkCase,
      providerId: input.providerId,
      apiKey: input.apiKey,
      configs,
      useMock: input.useMock,
      runControls: input.runControls,
      delayBeforeFirstModel: caseResults.length > 0,
    })
    caseResults.push(caseResult)

    const completedResults = caseResults.flatMap((result) => result.results)
    const failedResults = completedResults.filter((result) => result.status === 'error')
    if (!input.runControls.continueOnError && failedResults.length > 0) {
      break
    }
    const failureRate = completedResults.length > 0 ? (failedResults.length / completedResults.length) * 100 : 0
    if (failedResults.length > 0 && failureRate >= input.runControls.stopAfterFailureRatePercent) {
      break
    }
  }

  return NextResponse.json({
    batchId: `batch-${Date.now()}`,
    createdAt: new Date().toISOString(),
    providerId: input.providerId,
    caseCount: selectedCases.length,
    modelCount: selectedModelCount,
    selectedModelCount,
    workflowConfigCount,
    modelOnlyConfigCount,
    configCount: totalConfigCount,
    totalConfigCount,
    estimatedCalls,
    estimatedRiskLevel,
    benchmarkConfigs: configs.map(({ promptTemplateText, workflow, ...config }) => ({
      ...config,
      workflow: workflow
        ? {
            ...workflow,
            steps: workflow.steps.map(({ promptTemplateText: _promptTemplateText, ...step }) => step),
          }
        : undefined,
      hasPromptTemplateText: Boolean(promptTemplateText),
    })),
    runControls: input.runControls,
    cases: caseResults,
    aggregate: buildAggregate(caseResults),
  })
}
