import { NextResponse } from 'next/server'

import { parseLlmJson } from '@/lib/json-utils'
import { callProviderChatCompletion, type LlmProviderId } from '@/lib/llm-providers'
import { type PromptStrategyId } from '@/lib/openrouter'
import { deriveReferenceChecks, evaluateReferenceDecision } from '@/lib/pct-reference'
import { buildEvaluationPrompt } from '@/lib/prompt-builder'
import { normalizeLlmParsedOutput, scoreLlmOutput } from '@/lib/scoring'
import type {
  ClinicalCase,
  EvaluationResponse,
  LlmEvaluationResult,
  LlmParsedOutput,
  ReferenceChecks,
  ReferenceDecision,
  ReferenceRecommendation,
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
    }
  }

  return {
    caseData: body as ClinicalCase,
    selectedModelIds: [],
    providerId: 'openrouter',
    apiKey: null,
    defaultPromptTemplateId: undefined,
    defaultPromptTemplateText: undefined,
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

  const rawOutput = await callProviderChatCompletion(
    providerId,
    apiKey,
    config.modelId,
    [{ role: 'user', content: prompt }],
    { temperature: 0.1, max_tokens: 1000 },
  )

  const parsedJson = parseLlmJson(rawOutput)
  if (!parsedJson.ok) {
    return {
      configId: config.configId,
      modelLabel: config.modelLabel,
      promptStrategy,
      status: 'error',
      rawOutput,
      error: `Could not parse valid JSON: ${parsedJson.error}`,
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
    }
  }

  return {
    configId: config.configId,
    modelLabel: config.modelLabel,
    promptStrategy,
    status: 'success',
    parsedOutput,
    rawOutput,
    scores: scoreLlmOutput(parsedOutput, referenceDecision, caseData, referenceChecks),
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
): Promise<LlmEvaluationResult[]> {
  const configs =
    selectedModelIds.length > 0
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
      promptStrategy: getPromptStrategyLabel(config.promptStrategy),
      status: 'error',
      error: message,
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

  try {
    // No zod validation yet by design.
    const parsed = parseEvaluateRequestBody(await request.json())
    caseData = parsed.caseData
    selectedModelIds = parsed.selectedModelIds
    providerId = parsed.providerId
    apiKey = parsed.apiKey
    defaultPromptTemplateId = parsed.defaultPromptTemplateId
    defaultPromptTemplateText = parsed.defaultPromptTemplateText
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
