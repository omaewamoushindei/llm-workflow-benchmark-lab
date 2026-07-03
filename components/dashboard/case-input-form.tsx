"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { BenchmarkConfig, ClinicalCase, EvaluationResponse, LlmEvaluationResult, RunControls } from "@/lib/types"
import { calculatePctDeclinePercent, evaluateReferenceDecision } from "@/lib/pct-reference"
import { benchmarkCases, type BenchmarkCase } from "@/lib/benchmark-cases"
import { DEFAULT_PROMPT_TEMPLATES } from "@/lib/prompt-templates"
import { detectPromptInjectionInCase } from "@/lib/prompt-security"
import { Upload, FileText, Play, FlaskConical, Loader2 } from "lucide-react"

interface CaseInputFormProps {
  caseData: ClinicalCase
  onCaseDataChange: (data: ClinicalCase) => void
}

const EVALUATION_SETTINGS_STORAGE_KEY = "evaluationSettings"
const PROVIDER_API_KEYS_STORAGE_KEY = "providerApiKeys"
const PROMPT_TEMPLATES_STORAGE_KEY = "promptTemplates"
const DEFAULT_MODEL_ONLY_PROMPT_TEMPLATE_ID = "default-baseline-pct"
const CUSTOM_BENCHMARK_CASES_STORAGE_KEY = "customBenchmarkCases"
const MODEL_FAILURE_MESSAGE =
  "This model failed or is unavailable. Refresh models or choose another model in Evaluation Setup."

type ProviderId = "openrouter" | "groq"
type ProviderModelMetadata = {
  id: string
  name?: string
  provider?: ProviderId
  promptPrice?: string | null
  completionPrice?: string | null
}
type BatchEvaluationResponse = {
  providerId: ProviderId
  benchmarkConfigs?: BenchmarkConfig[]
  runControls?: RunControls
  cases: Array<{
    results: LlmEvaluationResult[]
  }>
}
type ExecutionConfigOption = {
  config: BenchmarkConfig
  label: string
  configType: "model_only" | "workflow"
  weightedScore: number | null
  recommendationMatch: number | null
  criterionAlignment: number | null
  safety: number | null
  explainability: number | null
  failedCalls: number
  stepCount: number
  estimatedCalls: number
  toolAssisted: boolean
  modelName?: string
  promptTemplateName?: string
  workflowName?: string
  pricingText: string
  estimatedCostText: string
}
type BenchmarkCaseFilter =
  | "all"
  | "thermo"
  | "synthetic"
  | "safety_exceptions"
  | "threshold"
  | "missing_information"
  | "lrti"
  | "sepsis_icu"

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function scoreOrZero(value: number | null): number {
  return value ?? 0
}

function formatScore(value: number | null | undefined): string {
  return value === null || value === undefined ? "N/A" : `${value.toFixed(1)}%`
}

function getWeightedScore(option: Pick<ExecutionConfigOption, "recommendationMatch" | "criterionAlignment" | "safety" | "explainability">): number {
  return (
    scoreOrZero(option.recommendationMatch) * 0.35 +
    scoreOrZero(option.criterionAlignment) * 0.3 +
    scoreOrZero(option.safety) * 0.25 +
    scoreOrZero(option.explainability) * 0.1
  )
}

function formatSourceType(sourceType: BenchmarkCase["sourceType"]): string {
  return sourceType === "thermo_case_adapted"
    ? "Thermo Fisher adapted"
    : "Synthetic algorithm case"
}

function getBenchmarkSourceBadge(sourceType: BenchmarkCase["sourceType"]): string {
  return sourceType === "thermo_case_adapted"
    ? "Thermo Fisher adapted case"
    : "Synthetic algorithm case"
}

function getBenchmarkSourceTransparencyNote(sourceType: BenchmarkCase["sourceType"]): string {
  return sourceType === "thermo_case_adapted"
    ? "Adapted from public Thermo Fisher PCT case study. Not a complete clinical gold standard; no affiliation or endorsement implied."
    : "Generated from deterministic PCT discontinuation logic for systematic testing."
}

function benchmarkCaseMatchesFilter(benchmarkCase: BenchmarkCase, filter: BenchmarkCaseFilter): boolean {
  switch (filter) {
    case "all":
      return true
    case "thermo":
      return benchmarkCase.sourceType === "thermo_case_adapted"
    case "synthetic":
      return benchmarkCase.sourceType === "synthetic_algorithm_case"
    case "safety_exceptions":
      return benchmarkCase.tags.some((tag) =>
        ["exception", "clinical_review_required", "renal_caution"].includes(tag),
      )
    case "threshold":
      return benchmarkCase.tags.some((tag) =>
        ["low_pct", "current_pct_below_threshold", "borderline", "pct_decline_gt_80", "pct_decline_lt_80"].includes(tag),
      )
    case "missing_information":
      return benchmarkCase.tags.some((tag) =>
        ["missing_clinical_improvement", "missing_infection_context", "insufficient_information"].includes(tag),
      )
    case "lrti":
      return benchmarkCase.tags.includes("lrti_non_icu") || benchmarkCase.caseData.infectionContext === "lrti_non_icu"
    case "sepsis_icu":
      return benchmarkCase.tags.includes("sepsis_icu") || benchmarkCase.caseData.infectionContext === "sepsis_icu"
    default: {
      const _exhaustive: never = filter
      return _exhaustive
    }
  }
}

function mapLegacyPromptStrategyToTemplateId(value: unknown): string {
  if (value === "structured" || value === "json") return "default-structured-pct-json"
  if (value === "verification" || value === "multistep") return "default-verification-checklist"
  return DEFAULT_MODEL_ONLY_PROMPT_TEMPLATE_ID
}

function readPromptTemplates() {
  try {
    const raw = window.localStorage.getItem(PROMPT_TEMPLATES_STORAGE_KEY)
    if (!raw) return DEFAULT_PROMPT_TEMPLATES
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return DEFAULT_PROMPT_TEMPLATES
    return parsed.filter((template): template is (typeof DEFAULT_PROMPT_TEMPLATES)[number] => {
      return (
        !!template &&
        typeof template === "object" &&
        typeof (template as { id?: unknown }).id === "string" &&
        typeof (template as { text?: unknown }).text === "string" &&
        typeof (template as { name?: unknown }).name === "string"
      )
    })
  } catch {
    return DEFAULT_PROMPT_TEMPLATES
  }
}

function readEvaluationSettings(): {
  providerId: ProviderId
  selectedModelIds: string[]
  defaultPromptTemplateId: string
  defaultPromptTemplateText: string
} {
  try {
    const raw = window.localStorage.getItem(EVALUATION_SETTINGS_STORAGE_KEY)
    const promptTemplates = readPromptTemplates()
    const baselineTemplate =
      promptTemplates.find((template) => template.id === DEFAULT_MODEL_ONLY_PROMPT_TEMPLATE_ID) ??
      DEFAULT_PROMPT_TEMPLATES[0]
    if (!raw) {
      return {
        providerId: "openrouter",
        selectedModelIds: [],
        defaultPromptTemplateId: baselineTemplate.id,
        defaultPromptTemplateText: baselineTemplate.text,
      }
    }

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") {
      return {
        providerId: "openrouter",
        selectedModelIds: [],
        defaultPromptTemplateId: baselineTemplate.id,
        defaultPromptTemplateText: baselineTemplate.text,
      }
    }

    const settings = parsed as {
      providerId?: unknown
      selectedModelIds?: unknown
      selectedModels?: unknown
      defaultPromptTemplateId?: unknown
      selectedPromptStrategy?: unknown
      selectedStrategy?: unknown
    }
    const selectedModels = Array.isArray(settings.selectedModelIds)
      ? settings.selectedModelIds
      : settings.selectedModels
    const providerId = settings.providerId === "groq" ? "groq" : "openrouter"
    const defaultPromptTemplateId =
      typeof settings.defaultPromptTemplateId === "string" && settings.defaultPromptTemplateId.trim()
        ? settings.defaultPromptTemplateId
        : mapLegacyPromptStrategyToTemplateId(settings.selectedPromptStrategy ?? settings.selectedStrategy)
    const defaultPromptTemplate =
      promptTemplates.find((template) => template.id === defaultPromptTemplateId) ?? baselineTemplate

    if (!Array.isArray(selectedModels)) {
      return {
        providerId,
        selectedModelIds: [],
        defaultPromptTemplateId: defaultPromptTemplate.id,
        defaultPromptTemplateText: defaultPromptTemplate.text,
      }
    }

    const selectedModelIds = selectedModels
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .slice(0, 3)

    return {
      providerId,
      selectedModelIds,
      defaultPromptTemplateId: defaultPromptTemplate.id,
      defaultPromptTemplateText: defaultPromptTemplate.text,
    }
  } catch {
    return {
      providerId: "openrouter",
      selectedModelIds: [],
      defaultPromptTemplateId: DEFAULT_MODEL_ONLY_PROMPT_TEMPLATE_ID,
      defaultPromptTemplateText: DEFAULT_PROMPT_TEMPLATES[0].text,
    }
  }
}

function readProviderApiKey(providerId: ProviderId): string | null {
  try {
    const raw = window.sessionStorage.getItem(PROVIDER_API_KEYS_STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return null

    const key = (parsed as Record<ProviderId, { key?: unknown } | undefined>)[providerId]?.key
    return typeof key === "string" && key.trim() ? key.trim() : null
  } catch {
    return null
  }
}

function readLatestBatchResponse(): BatchEvaluationResponse | null {
  try {
    const raw = window.sessionStorage.getItem("latestBatchEvaluationResponse")
    if (!raw) return null
    const parsed = JSON.parse(raw) as BatchEvaluationResponse
    return Array.isArray(parsed.cases) ? parsed : null
  } catch {
    return null
  }
}

function readProviderModelCatalog(): ProviderModelMetadata[] {
  try {
    const raw = window.sessionStorage.getItem("latestProviderModelCatalog")
    if (!raw) return []
    const parsed = JSON.parse(raw) as { models?: ProviderModelMetadata[] }
    return Array.isArray(parsed.models) ? parsed.models : []
  } catch {
    return []
  }
}

function readRunControls(): RunControls | undefined {
  try {
    const raw = window.localStorage.getItem(EVALUATION_SETTINGS_STORAGE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as { runControls?: RunControls }
    return parsed.runControls
  } catch {
    return undefined
  }
}

function getModelIdsForConfig(config: BenchmarkConfig): string[] {
  if (config.configType === "workflow" && config.workflow) {
    return config.workflow.steps
      .filter((step) => step.stepType !== "deterministic_precheck" && !!step.modelId)
      .map((step) => step.modelId as string)
  }
  return config.modelId ? [config.modelId] : []
}

function getEstimatedCallsForConfig(config: BenchmarkConfig): number {
  const calls = getModelIdsForConfig(config).length
  return Math.max(1, calls)
}

function getPromptTemplateName(promptTemplateId: string | undefined): string | undefined {
  if (!promptTemplateId) return undefined
  const template = readPromptTemplates().find((item) => item.id === promptTemplateId)
  return template?.name
}

function readPriceNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getPricingForConfig(config: BenchmarkConfig, catalog: ProviderModelMetadata[]): {
  pricingText: string
  estimatedCostText: string
  modelName?: string
} {
  const modelIds = getModelIdsForConfig(config)
  const models = modelIds.map((id) => catalog.find((model) => model.id === id)).filter(Boolean) as ProviderModelMetadata[]
  const modelName = models[0]?.name ?? modelIds[0]

  if (modelIds.length === 0 || models.length !== modelIds.length) {
    return {
      pricingText:
        config.providerId === "groq"
          ? "Pricing unavailable from catalog. Free/on-demand usage may be rate-limited."
          : "Pricing unavailable",
      estimatedCostText: "Estimated cost unavailable",
      modelName,
    }
  }

  const prices = models.map((model) => ({
    prompt: readPriceNumber(model.promptPrice),
    completion: readPriceNumber(model.completionPrice),
  }))
  if (prices.some((price) => price.prompt === null || price.completion === null)) {
    return {
      pricingText:
        config.providerId === "groq"
          ? "Pricing unavailable from catalog. Free/on-demand usage may be rate-limited."
          : "Pricing unavailable",
      estimatedCostText: modelIds.length > 1 ? "Partial/unknown workflow estimate" : "Estimated cost unavailable",
      modelName,
    }
  }

  const promptTotal = prices.reduce((sum, price) => sum + (price.prompt ?? 0), 0)
  const completionTotal = prices.reduce((sum, price) => sum + (price.completion ?? 0), 0)
  return {
    pricingText: `Input ${promptTotal}/token | Output ${completionTotal}/token`,
    estimatedCostText: `Estimated single-case cost depends on token usage across ${getEstimatedCallsForConfig(config)} call(s).`,
    modelName,
  }
}

function buildExecutionOptions(batch: BatchEvaluationResponse | null, catalog: ProviderModelMetadata[]): ExecutionConfigOption[] {
  if (!batch) return []

  const configsById = new Map((batch.benchmarkConfigs ?? []).map((config) => [config.configId, config]))
  const allResults = batch.cases.flatMap((caseResult) => caseResult.results)
  const configIds = Array.from(new Set([...configsById.keys(), ...allResults.map((result) => result.configId)]))

  return configIds
    .map((configId): ExecutionConfigOption | null => {
      const results = allResults.filter((result) => result.configId === configId)
      const scored = results.filter(
        (result): result is LlmEvaluationResult & { scores: NonNullable<LlmEvaluationResult["scores"]> } =>
          result.status === "success" && !!result.scores,
      )
      const fallbackResult = results[0]
      const config =
        configsById.get(configId) ??
        ({
          configId,
          label: fallbackResult?.configLabel ?? fallbackResult?.modelLabel ?? configId,
          configType: fallbackResult?.configType ?? "model_only",
          providerId: batch.providerId,
          modelId: fallbackResult?.modelLabel,
          stepCount: fallbackResult?.workflowStepCount,
          toolAssisted: fallbackResult?.toolAssisted,
        } satisfies BenchmarkConfig)
      const recommendationMatch = average(scored.map((result) => result.scores.recommendationMatch ?? 0))
      const criterionAlignment = average(scored.map((result) => result.scores.alignment))
      const safety = average(scored.map((result) => result.scores.safety))
      const explainability = average(scored.map((result) => result.scores.explainability))
      const pricing = getPricingForConfig(config, catalog)
      const option = {
        config,
        label: config.label ?? fallbackResult?.configLabel ?? fallbackResult?.modelLabel ?? configId,
        configType: config.configType,
        weightedScore: null,
        recommendationMatch,
        criterionAlignment,
        safety,
        explainability,
        failedCalls: results.filter((result) => result.status === "error").length,
        stepCount: config.stepCount ?? config.workflow?.steps.length ?? 1,
        estimatedCalls: getEstimatedCallsForConfig(config),
        toolAssisted: Boolean(config.toolAssisted),
        modelName: pricing.modelName,
        promptTemplateName: getPromptTemplateName(config.promptTemplateId),
        workflowName: config.workflow?.name ?? fallbackResult?.workflowName,
        pricingText: pricing.pricingText,
        estimatedCostText: pricing.estimatedCostText,
      }
      return { ...option, weightedScore: getWeightedScore(option) }
    })
    .filter((option): option is ExecutionConfigOption => option !== null)
    .sort((a, b) => {
      return (
        scoreOrZero(b.weightedScore) - scoreOrZero(a.weightedScore) ||
        scoreOrZero(b.safety) - scoreOrZero(a.safety) ||
        a.failedCalls - b.failedCalls
      )
    })
}

function hydrateExecutionConfig(config: BenchmarkConfig): BenchmarkConfig {
  const promptTemplates = readPromptTemplates()
  const templateById = new Map(promptTemplates.map((template) => [template.id, template]))
  const promptTemplateText =
    config.promptTemplateText ?? (config.promptTemplateId ? templateById.get(config.promptTemplateId)?.text : undefined)

  return {
    ...config,
    promptTemplateText,
    workflow: config.workflow
      ? {
          ...config.workflow,
          steps: config.workflow.steps.map((step) => ({
            ...step,
            promptTemplateText:
              step.promptTemplateText ?? (step.promptTemplateId ? templateById.get(step.promptTemplateId)?.text : undefined),
          })),
        }
      : undefined,
  }
}

function getLlmResultsDescription(response: EvaluationResponse): string {
  if (response.metadata?.evaluationMode === "live") {
    return `Live outputs from ${response.metadata.providerLabel || response.metadata.providerId || "selected provider"}`
  }

  return "Mocked outputs for the current MVP"
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "N/A" : String(value)
}

function formatNullablePercent(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(1)}%`
}

function formatNullableBoolean(value: boolean | null | undefined): string {
  if (value === true) return "Yes"
  if (value === false) return "No"
  return "N/A"
}

function getRecommendationMatchScore(response: EvaluationResponse, result: EvaluationResponse["results"][number]): number | null {
  if (typeof result.scores?.recommendationMatch === "number") return result.scores.recommendationMatch
  if (!result.parsedOutput) return null
  return result.parsedOutput.recommendation === response.referenceDecision.recommendation ? 100 : 0
}

function formatMatch(value: number | null): string {
  if (value === null) return "N/A"
  return value === 100 ? "Yes" : "No"
}

function getBooleanMatch(modelValue: boolean | null | undefined, expectedValue: boolean | null | undefined): boolean | null {
  if (modelValue === null || modelValue === undefined || expectedValue === null || expectedValue === undefined) return null
  return modelValue === expectedValue
}

function getNumberMatch(modelValue: number | null | undefined, expectedValue: number | null | undefined, tolerance: number): boolean | null {
  if (modelValue === null || modelValue === undefined || expectedValue === null || expectedValue === undefined) return null
  return Math.abs(modelValue - expectedValue) <= tolerance
}

function ComparisonStatus({ match }: { match: boolean | null }) {
  if (match === null) {
    return <span className="text-muted-foreground">Not comparable</span>
  }

  return (
    <span className={match ? "text-success" : "text-destructive"}>
      {match ? "Match" : "Mismatch"}
    </span>
  )
}

function BooleanComparisonRow({
  label,
  modelValue,
  expectedValue,
}: {
  label: string
  modelValue: boolean | null | undefined
  expectedValue: boolean | null | undefined
}) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-1">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium text-foreground">Model = {formatNullableBoolean(modelValue)}</span>
      <span className="text-muted-foreground">Expected = {formatNullableBoolean(expectedValue)}</span>
      <ComparisonStatus match={getBooleanMatch(modelValue, expectedValue)} />
    </div>
  )
}

function PercentComparisonRow({
  label,
  modelValue,
  expectedValue,
}: {
  label: string
  modelValue: number | null | undefined
  expectedValue: number | null | undefined
}) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-1">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium text-foreground">
        Model = {modelValue === null || modelValue === undefined ? "N/A" : `${modelValue.toFixed(1)}%`}
      </span>
      <span className="text-muted-foreground">
        Expected = {expectedValue === null || expectedValue === undefined ? "N/A" : `${expectedValue.toFixed(1)}%`}
      </span>
      <ComparisonStatus match={getNumberMatch(modelValue, expectedValue, 5)} />
    </div>
  )
}

export function CaseInputForm({ caseData, onCaseDataChange }: CaseInputFormProps) {
  const [dragActive, setDragActive] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [evaluationResponse, setEvaluationResponse] = useState<EvaluationResponse | null>(null)
  const [selectedBenchmarkCaseId, setSelectedBenchmarkCaseId] = useState<string>("")
  const [benchmarkCaseFilter, setBenchmarkCaseFilter] = useState<BenchmarkCaseFilter>("all")
  const [latestBatchResponse, setLatestBatchResponse] = useState<BatchEvaluationResponse | null>(null)
  const [providerModelCatalog, setProviderModelCatalog] = useState<ProviderModelMetadata[]>([])
  const [selectedExecutionConfigId, setSelectedExecutionConfigId] = useState<string>("")
  const [saveCaseMessage, setSaveCaseMessage] = useState<string | null>(null)

  useEffect(() => {
    try {
      setLatestBatchResponse(readLatestBatchResponse())
      setProviderModelCatalog(readProviderModelCatalog())
      const stored = sessionStorage.getItem("latestSingleCaseExecutionResponse") ?? sessionStorage.getItem("latestEvaluationResponse")
      if (!stored) return
      const parsed = JSON.parse(stored) as EvaluationResponse
      setEvaluationResponse(parsed)
    } catch {
      // Ignore invalid session storage payloads.
    }
  }, [])

  useEffect(() => {
    const options = buildExecutionOptions(latestBatchResponse, providerModelCatalog)
    if (options.length === 0) return
    setSelectedExecutionConfigId((current) =>
      current && options.some((option) => option.config.configId === current)
        ? current
        : options[0].config.configId,
    )
  }, [latestBatchResponse, providerModelCatalog])

  const updateCaseData = (patch: Partial<ClinicalCase>) => {
    onCaseDataChange({ ...caseData, ...patch })
  }

  const parseNullableNumber = (value: string): number | null => {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    } else if (e.type === "drop") {
      setDragActive(false)
      void handleCaseFileUpload(e.dataTransfer.files?.[0] ?? null)
    }
  }

  const selectedBenchmarkCase =
    benchmarkCases.find((benchmarkCase) => benchmarkCase.id === selectedBenchmarkCaseId) ?? null
  const filteredBenchmarkCases = benchmarkCases.filter((benchmarkCase) =>
    benchmarkCaseMatchesFilter(benchmarkCase, benchmarkCaseFilter),
  )
  const executionOptions = useMemo(
    () => buildExecutionOptions(latestBatchResponse, providerModelCatalog),
    [latestBatchResponse, providerModelCatalog],
  )
  const selectedExecutionOption =
    executionOptions.find((option) => option.config.configId === selectedExecutionConfigId) ?? null
  const narrativePromptInjectionDetected =
    detectPromptInjectionInCase(caseData).detected ||
    Boolean(evaluationResponse?.metadata?.narrativePromptInjectionDetected)

  const loadBenchmarkCase = (benchmarkCaseId: string) => {
    const benchmarkCase = benchmarkCases.find((item) => item.id === benchmarkCaseId)
    if (!benchmarkCase) return

    const nextCaseData = { ...benchmarkCase.caseData }
    setSelectedBenchmarkCaseId(benchmarkCase.id)
    onCaseDataChange(nextCaseData)
    setEvaluationResponse(null)
    setError(null)

    try {
      sessionStorage.setItem("latestClinicalCase", JSON.stringify(nextCaseData))
      sessionStorage.removeItem("latestEvaluationResponse")
    } catch {
      // Ignore unavailable or invalid browser session storage.
    }
  }

  const handleCaseFileUpload = async (file: File | null) => {
    if (!file) return
    const extension = file.name.split(".").pop()?.toLowerCase()
    if (extension !== "txt") {
      setError("PDF/DOCX parsing is not implemented in this MVP.")
      return
    }

    const text = await file.text()
    updateCaseData({
      caseDescription: [caseData.caseDescription, text].filter(Boolean).join("\n\n"),
    })
    setError(null)
  }

  const saveToCaseLibrary = () => {
    try {
      const now = new Date().toISOString()
      const referenceDecision = evaluateReferenceDecision(caseData)
      const title =
        caseData.caseDescription.split("\n")[0]?.trim().slice(0, 80) ||
        caseData.clinicalNotes.split("\n")[0]?.trim().slice(0, 80) ||
        `Manual case ${now}`
      const customCase = {
        id: `custom-${Date.now()}`,
        title,
        sourceType: "synthetic_algorithm_case" as const,
        description: caseData.caseDescription || caseData.clinicalNotes || "Manual case saved from Single Case Execution.",
        caseData,
        expectedReferenceLabel: referenceDecision.recommendation,
        tags: ["custom", caseData.infectionContext, referenceDecision.recommendation],
        sourceNote: "Saved from manual Single Case Execution page.",
        limitations: "User-entered case. Structured fields should be reviewed before batch benchmarking.",
        createdAt: now,
        updatedAt: now,
      }
      const raw = window.localStorage.getItem(CUSTOM_BENCHMARK_CASES_STORAGE_KEY)
      const existing = raw ? JSON.parse(raw) : []
      const next = Array.isArray(existing) ? [...existing, customCase] : [customCase]
      window.localStorage.setItem(CUSTOM_BENCHMARK_CASES_STORAGE_KEY, JSON.stringify(next))
      setSaveCaseMessage("Saved to local custom case library.")
    } catch {
      setSaveCaseMessage("Could not save this case to the local case library.")
    }
  }

  const pctDeclinePercent = calculatePctDeclinePercent(caseData.peakPct, caseData.currentPct)

  const runEvaluation = async () => {
    setIsRunning(true)
    setError(null)

    try {
      const evaluationSettings = readEvaluationSettings()
      const executionConfig = selectedExecutionOption?.config
      const providerId = executionConfig?.providerId ?? evaluationSettings.providerId
      const apiKey = readProviderApiKey(providerId)
      const hydratedExecutionConfig = executionConfig ? hydrateExecutionConfig(executionConfig) : null

      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          caseData,
          providerId,
          apiKey,
          selectedModelIds: hydratedExecutionConfig ? [] : evaluationSettings.selectedModelIds.slice(0, 1),
          defaultPromptTemplateId: evaluationSettings.defaultPromptTemplateId,
          defaultPromptTemplateText: evaluationSettings.defaultPromptTemplateText,
          executionConfig: hydratedExecutionConfig,
          promptTemplates: readPromptTemplates(),
          runControls: readRunControls(),
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || `Request failed with status ${response.status}`)
      }

      const json = (await response.json()) as EvaluationResponse
      setEvaluationResponse(json)
      sessionStorage.setItem("latestSingleCaseExecutionResponse", JSON.stringify(json))
      sessionStorage.setItem("latestEvaluationResponse", JSON.stringify(json))
      sessionStorage.setItem("latestClinicalCase", JSON.stringify(caseData))
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error"
      setError(message)
      setEvaluationResponse(null)
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Execution Configuration</CardTitle>
          <CardDescription>
            Select the evaluated model, prompt, or workflow configuration for this one-case demo
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {executionOptions.length > 0 ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="executionConfig">Ranked configuration</Label>
                <Select value={selectedExecutionConfigId} onValueChange={setSelectedExecutionConfigId}>
                  <SelectTrigger id="executionConfig">
                    <SelectValue placeholder="Select execution configuration" />
                  </SelectTrigger>
                  <SelectContent>
                    {executionOptions.map((option) => (
                      <SelectItem key={option.config.configId} value={option.config.configId}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Configurations are sorted by latest benchmark report. You can override the recommendation.
                </p>
              </div>

              {selectedExecutionOption ? (
                <div className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{selectedExecutionOption.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {selectedExecutionOption.configType} | {selectedExecutionOption.stepCount} step(s) |{" "}
                        {selectedExecutionOption.estimatedCalls} estimated LLM call(s)
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-border px-2.5 py-1 text-xs">
                        Weighted {formatScore(selectedExecutionOption.weightedScore)}
                      </span>
                      {selectedExecutionOption.toolAssisted ? (
                        <span className="rounded-full border border-border px-2.5 py-1 text-xs">Tool-assisted</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Recommendation</p>
                      <p className="text-sm font-medium">{formatScore(selectedExecutionOption.recommendationMatch)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Criterion</p>
                      <p className="text-sm font-medium">{formatScore(selectedExecutionOption.criterionAlignment)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Safety</p>
                      <p className="text-sm font-medium">{formatScore(selectedExecutionOption.safety)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Explainability</p>
                      <p className="text-sm font-medium">{formatScore(selectedExecutionOption.explainability)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Model / Workflow</p>
                      <p className="text-sm text-foreground">
                        {selectedExecutionOption.workflowName ??
                          selectedExecutionOption.modelName ??
                          selectedExecutionOption.config.modelId ??
                          "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Prompt template</p>
                      <p className="text-sm text-foreground">{selectedExecutionOption.promptTemplateName ?? "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Pricing</p>
                      <p className="text-sm text-foreground">{selectedExecutionOption.pricingText}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Single-case estimate</p>
                      <p className="text-sm text-foreground">{selectedExecutionOption.estimatedCostText}</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
              <p className="text-sm font-medium text-foreground">
                No benchmark report found. Run a benchmark first to rank execution configurations.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                You can still use the current Evaluation Setup configuration, but it is unranked.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Required PCT Logic Fields</CardTitle>
              <CardDescription>These structured inputs drive the deterministic reference checks</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {narrativePromptInjectionDetected ? (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
              Instruction-like content detected in narrative context. Structured fields remain authoritative.
            </div>
          ) : null}

          <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            Structured fields drive reference checks. Description text is provided as additional context to the model.
          </p>

          <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            Required benchmark inputs are clinical setting, PCT values, antibiotic status, clinical improvement, and
            exclusion/caution status. Age, sex, labs, and narrative text are optional context only.
          </div>

          <details className="rounded-lg border border-border bg-muted/20 p-3">
            <summary className="cursor-pointer text-sm font-medium text-foreground">Optional Context</summary>
            <div className="mt-3 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="patientAge">Age (optional)</Label>
              <Input
                id="patientAge"
                type="number"
                placeholder="e.g., 65"
                value={caseData.patientAge ?? ""}
                onChange={(e) => updateCaseData({ patientAge: parseNullableNumber(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sex">Sex (optional)</Label>
              <Select value={caseData.sex} onValueChange={(v) => updateCaseData({ sex: v })}>
                <SelectTrigger id="sex">
                  <SelectValue placeholder="Select sex" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Clinical Info */}
          <div className="space-y-2">
              <Label htmlFor="symptoms">Renal impairment / hemodialysis, symptoms, or other optional context</Label>
            <Input
              id="symptoms"
              placeholder="e.g., Fever, cough, fatigue"
              value={caseData.symptoms}
              onChange={(e) => updateCaseData({ symptoms: e.target.value })}
            />
          </div>
            </div>
          </details>

          <div>
            <h4 className="text-sm font-medium text-foreground">Required PCT Logic Fields</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Age and sex are not used as required deterministic criteria.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="infectionContext">Clinical setting / infection context</Label>
              <Select
                value={caseData.infectionContext}
                onValueChange={(v) => updateCaseData({ infectionContext: v as ClinicalCase["infectionContext"] })}
              >
                <SelectTrigger id="infectionContext">
                  <SelectValue placeholder="Select context" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lrti_non_icu">LRTI / non-ICU</SelectItem>
                  <SelectItem value="sepsis_icu">Sepsis / ICU</SelectItem>
                  <SelectItem value="other_or_unclear">Other / uncertain</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="antibioticStatus">Patient currently on antibiotics?</Label>
              <Select
                value={caseData.currentAntibioticStatus}
                onValueChange={(v) => updateCaseData({ currentAntibioticStatus: v })}
              >
                <SelectTrigger id="antibioticStatus">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not-started">No / not started</SelectItem>
                  <SelectItem value="empirical">Yes / empirical therapy</SelectItem>
                  <SelectItem value="targeted">Yes / targeted therapy</SelectItem>
                  <SelectItem value="de-escalation">Yes / de-escalation</SelectItem>
                  <SelectItem value="completed">Completed course</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="clinicalImprovement">Clinical improvement present?</Label>
              <Select
                value={caseData.clinicalImprovement}
                onValueChange={(v) =>
                  updateCaseData({ clinicalImprovement: v as ClinicalCase["clinicalImprovement"] })
                }
              >
                <SelectTrigger id="clinicalImprovement">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="unclear">Unclear</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="antibioticsDurationDays">Antibiotics Duration Days</Label>
              <Input
                id="antibioticsDurationDays"
                type="number"
                placeholder="e.g., 3"
                value={caseData.antibioticsDurationDays ?? ""}
                onChange={(e) =>
                  updateCaseData({
                    antibioticsDurationDays: parseNullableNumber(e.target.value),
                  })
                }
              />
            </div>
          </div>

          {/* Lab Values */}
          <div className="pt-2">
            <h4 className="text-sm font-medium text-foreground mb-3">Laboratory Values</h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="peakPct">
                  Peak or previous PCT value
                  <span className="text-muted-foreground font-normal ml-1">ng/mL</span>
                </Label>
                <Input
                  id="peakPct"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 1.2"
                  value={caseData.peakPct ?? ""}
                  onChange={(e) => updateCaseData({ peakPct: parseNullableNumber(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="currentPct">
                  Current PCT value
                  <span className="text-muted-foreground font-normal ml-1">ng/mL</span>
                </Label>
                <Input
                  id="currentPct"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 0.25"
                  value={caseData.currentPct ?? ""}
                  onChange={(e) => updateCaseData({ currentPct: parseNullableNumber(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wbc">
                  WBC
                  <span className="text-muted-foreground font-normal ml-1">×10⁹/L</span>
                </Label>
                <Input
                  id="wbc"
                  type="number"
                  step="0.1"
                  placeholder="e.g., 12.5"
                  value={caseData.wbc ?? ""}
                  onChange={(e) => updateCaseData({ wbc: parseNullableNumber(e.target.value) })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="crp">
                  CRP
                  <span className="text-muted-foreground font-normal ml-1">mg/L</span>
                </Label>
                <Input
                  id="crp"
                  type="number"
                  step="0.1"
                  placeholder="e.g., 85"
                  value={caseData.crp ?? ""}
                  onChange={(e) => updateCaseData({ crp: parseNullableNumber(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exclusionCondition">Exclusion or caution condition present?</Label>
                <Select
                  value={caseData.exclusionCondition}
                  onValueChange={(v) =>
                    updateCaseData({ exclusionCondition: v as ClinicalCase["exclusionCondition"] })
                  }
                >
                  <SelectTrigger id="exclusionCondition">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="immunosuppression">Immunosuppression</SelectItem>
                    <SelectItem value="endocarditis">Endocarditis</SelectItem>
                    <SelectItem value="s_aureus_bacteremia">S. aureus bacteremia</SelectItem>
                    <SelectItem value="candidemia">Candidemia</SelectItem>
                    <SelectItem value="other_caution">Other / Caution</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {pctDeclinePercent !== null && (
              <div className="mt-4 text-sm text-muted-foreground">
                PCT decline from peak: <span className="text-foreground font-medium">{pctDeclinePercent.toFixed(1)}%</span>
              </div>
            )}
          </div>

          {/* Clinical Notes */}
          <div className="space-y-2">
            <Label htmlFor="clinicalNotes">Brief clinical notes</Label>
            <Textarea
              id="clinicalNotes"
              placeholder="Short notes relevant to clinical improvement, source control, cautions, or uncertainty..."
              rows={3}
              value={caseData.clinicalNotes}
              onChange={(e) => updateCaseData({ clinicalNotes: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Optional context card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-accent" />
            </div>
            <div>
              <CardTitle className="text-lg">Optional Case Context</CardTitle>
              <CardDescription>Add narrative context or upload a text file</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="caseDescription">Other context / case description</Label>
            <Textarea
              id="caseDescription"
              placeholder="Paste supporting case context here..."
              rows={4}
              value={caseData.caseDescription}
              onChange={(e) => updateCaseData({ caseDescription: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Description text supports LLM context only. Review structured fields before running.
            </p>
          </div>

          {/* File Upload */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              dragActive ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50"
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrag}
          >
            <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium text-foreground">Upload case file</p>
            <p className="text-xs text-muted-foreground mt-1">
              Drag and drop a .txt file or use the file picker
            </p>
            <p className="text-xs text-muted-foreground">
              Uploaded text is added as case context. Review structured fields before running.
            </p>
            <p className="text-xs text-muted-foreground">
              PDF/DOCX parsing is not implemented in this MVP.
            </p>
            <Input
              type="file"
              accept=".txt"
              className="mt-3 max-w-sm mx-auto"
              onChange={(event) => void handleCaseFileUpload(event.target.files?.[0] ?? null)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button className="flex-1 gap-2" size="lg" onClick={runEvaluation} disabled={isRunning}>
          {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {isRunning ? "Running..." : "Run This Case"}
        </Button>
        <Button className="gap-2" size="lg" variant="outline" onClick={saveToCaseLibrary} disabled={isRunning}>
          Save as Benchmark Case
        </Button>
        <div className="sm:w-56">
          <Select
            value={benchmarkCaseFilter}
            onValueChange={(value) => setBenchmarkCaseFilter(value as BenchmarkCaseFilter)}
          >
            <SelectTrigger aria-label="Filter benchmark cases" className="h-11">
              <SelectValue placeholder="Filter cases" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="thermo">Thermo Fisher adapted</SelectItem>
              <SelectItem value="synthetic">Synthetic algorithm cases</SelectItem>
              <SelectItem value="safety_exceptions">Safety exceptions</SelectItem>
              <SelectItem value="threshold">Threshold cases</SelectItem>
              <SelectItem value="missing_information">Missing information cases</SelectItem>
              <SelectItem value="lrti">LRTI</SelectItem>
              <SelectItem value="sepsis_icu">Sepsis/ICU</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:w-96">
          <Select value={selectedBenchmarkCaseId} onValueChange={loadBenchmarkCase}>
            <SelectTrigger aria-label="Load benchmark case" className="h-11">
              <SelectValue placeholder="Load benchmark case" />
            </SelectTrigger>
            <SelectContent>
              {filteredBenchmarkCases.map((benchmarkCase) => (
                <SelectItem key={benchmarkCase.id} value={benchmarkCase.id}>
                  <div className="flex flex-col gap-1 py-1">
                    <span className="font-medium">{benchmarkCase.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatSourceType(benchmarkCase.sourceType)} | Expected: {benchmarkCase.expectedReferenceLabel}
                    </span>
                    <span className="text-xs text-muted-foreground">{benchmarkCase.tags.join(", ")}</span>
                  </div>
                </SelectItem>
              ))}
              {filteredBenchmarkCases.length === 0 && (
                <SelectItem value="no-filtered-cases" disabled>
                  No cases match this filter
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {saveCaseMessage ? (
        <p className="text-sm text-muted-foreground">{saveCaseMessage}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Only saved benchmark cases can be selected later for batch benchmark reports.
      </p>

      {selectedBenchmarkCase && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-medium">{selectedBenchmarkCase.title}</CardTitle>
                <CardDescription>
                  Expected reference label: {selectedBenchmarkCase.expectedReferenceLabel}
                </CardDescription>
              </div>
              <span className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-foreground">
                {getBenchmarkSourceBadge(selectedBenchmarkCase.sourceType)}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground">Source Transparency</p>
              <p className="mt-1 text-muted-foreground leading-relaxed">
                {getBenchmarkSourceTransparencyNote(selectedBenchmarkCase.sourceType)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Expected Reference Label</p>
              <p className="mt-1 font-medium text-foreground">{selectedBenchmarkCase.expectedReferenceLabel}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tags</p>
              <p className="mt-1 text-muted-foreground leading-relaxed">{selectedBenchmarkCase.tags.join(", ")}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Limitations</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                {selectedBenchmarkCase.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-4">
            <p className="text-sm font-medium text-destructive">Evaluation failed</p>
            <p className="text-sm text-muted-foreground mt-1 wrap-break-word">{error}</p>
          </CardContent>
        </Card>
      )}

      {evaluationResponse && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Result Summary</CardTitle>
              <CardDescription>
                Output label, key reference checks, safety notes, and limitations for this single-case run
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {evaluationResponse.metadata?.narrativePromptInjectionDetected ? (
                <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
                  Instruction-like content detected in narrative context. Structured fields remain authoritative.
                </div>
              ) : null}

              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <div>
                  <span className="text-muted-foreground">Output label / recommendation category: </span>
                  <span className="font-medium text-foreground">{evaluationResponse.referenceDecision.recommendation}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Threshold Used: </span>
                  <span className="font-medium text-foreground">
                    {evaluationResponse.referenceDecision.thresholdUsed ?? "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">PCT Decline: </span>
                  <span className="font-medium text-foreground">
                    {evaluationResponse.referenceDecision.pctDeclinePercent === null
                      ? "—"
                      : `${evaluationResponse.referenceDecision.pctDeclinePercent.toFixed(1)}%`}
                  </span>
                </div>
              </div>

              {evaluationResponse.referenceChecks ? (
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <div>
                    <span className="text-muted-foreground">Absolute Threshold Met: </span>
                    <span className="font-medium text-foreground">
                      {formatNullableBoolean(evaluationResponse.referenceChecks.absoluteThresholdMet)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">PCT Decline Criterion Met: </span>
                    <span className="font-medium text-foreground">
                      {formatNullableBoolean(evaluationResponse.referenceChecks.pctDeclineCriterionMet)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Clinical Improvement Present: </span>
                    <span className="font-medium text-foreground">
                      {formatNullableBoolean(evaluationResponse.referenceChecks.clinicalImprovementPresent)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Exclusion Present: </span>
                    <span className="font-medium text-foreground">
                      {formatNullableBoolean(evaluationResponse.referenceChecks.exclusionConditionPresent)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Discontinuation Gate Passed: </span>
                    <span className="font-medium text-foreground">
                      {formatNullableBoolean(evaluationResponse.referenceChecks.discontinuationGatePassed)}
                    </span>
                  </div>
                </div>
              ) : null}

              <div>
                <p className="text-muted-foreground">Criteria Met</p>
                <p className="mt-1">
                  {evaluationResponse.referenceDecision.criteriaMet.length > 0
                    ? evaluationResponse.referenceDecision.criteriaMet.join(", ")
                    : "—"}
                </p>
              </div>

              <div>
                <p className="text-muted-foreground">Safety Concerns</p>
                <p className="mt-1">
                  {evaluationResponse.referenceDecision.safetyConcerns.length > 0
                    ? evaluationResponse.referenceDecision.safetyConcerns.join(", ")
                    : "—"}
                </p>
              </div>

              <div>
                <p className="text-muted-foreground">Short Explanation</p>
                <p className="mt-1 text-muted-foreground leading-relaxed">
                  {evaluationResponse.referenceDecision.explanation}
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-muted-foreground">Limitations</p>
                <p className="mt-1 text-muted-foreground leading-relaxed">
                  Prototype benchmark output only. This is not clinical advice, and this single-case execution is not
                  included in aggregate benchmark reports unless saved as a benchmark case and selected in a batch run.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Model Output</CardTitle>
              <CardDescription>{getLlmResultsDescription(evaluationResponse)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {evaluationResponse.results.map((result) => {
                const recommendationMatch = getRecommendationMatchScore(evaluationResponse, result)
                const referenceChecks = evaluationResponse.referenceChecks

                return (
                <div key={result.configId} className="rounded-lg border border-border p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">{result.modelLabel}</p>
                      <p className="text-xs text-muted-foreground">{result.promptStrategy}</p>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Status: <span className="text-foreground font-medium">{result.status}</span>
                    </div>
                  </div>

                  {result.status === "success" && result.parsedOutput && result.scores ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex flex-wrap gap-x-6 gap-y-1">
                        <div>
                          <span className="text-muted-foreground">Recommendation: </span>
                          <span className="font-medium text-foreground">{result.parsedOutput.recommendation}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Final Recommendation Match: </span>
                          <span className="font-medium text-foreground">{formatMatch(recommendationMatch)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Threshold: </span>
                          <span className="font-medium text-foreground">
                            {formatNullableNumber(result.parsedOutput.threshold_used)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">PCT Decline: </span>
                          <span className="font-medium text-foreground">
                            {formatNullablePercent(result.parsedOutput.pct_decline_calculated)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Absolute Threshold Met: </span>
                          <span className="font-medium text-foreground">
                            {formatNullableBoolean(result.parsedOutput.absolute_threshold_met)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">PCT Decline Criterion Met: </span>
                          <span className="font-medium text-foreground">
                            {formatNullableBoolean(result.parsedOutput.pct_decline_threshold_met)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Clinical Improvement Present: </span>
                          <span className="font-medium text-foreground">
                            {formatNullableBoolean(result.parsedOutput.clinical_improvement_present)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Exclusion Present: </span>
                          <span className="font-medium text-foreground">
                            {formatNullableBoolean(result.parsedOutput.exclusion_condition_present)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Discontinuation Gate Passed: </span>
                          <span className="font-medium text-foreground">
                            {formatNullableBoolean(result.parsedOutput.safety_gate_passed)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Audit Current PCT: </span>
                          <span className="font-medium text-foreground">
                            {formatNullableNumber(result.parsedOutput?.calculation_audit?.current_pct ?? null)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Audit Threshold: </span>
                          <span className="font-medium text-foreground">
                            {formatNullableNumber(result.parsedOutput?.calculation_audit?.threshold_used ?? null)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Audit Current PCT &lt;= Threshold: </span>
                          <span className="font-medium text-foreground">
                            {formatNullableBoolean(result.parsedOutput?.calculation_audit?.current_pct_less_or_equal_threshold)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Audit Peak PCT: </span>
                          <span className="font-medium text-foreground">
                            {formatNullableNumber(result.parsedOutput?.calculation_audit?.peak_pct ?? null)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Audit PCT Decline: </span>
                          <span className="font-medium text-foreground">
                            {formatNullablePercent(result.parsedOutput?.calculation_audit?.pct_decline_percent ?? null)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Audit PCT Decline &gt;80%: </span>
                          <span className="font-medium text-foreground">
                            {formatNullableBoolean(result.parsedOutput?.calculation_audit?.pct_decline_greater_than_80)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Criterion Alignment: </span>
                          <span className="font-medium text-foreground">{result.scores.alignment}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Safety: </span>
                          <span className="font-medium text-foreground">{result.scores.safety}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Explainability: </span>
                          <span className="font-medium text-foreground">{result.scores.explainability}</span>
                        </div>
                      </div>

                      {referenceChecks ? (
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Structured Criteria Checks</p>
                          <BooleanComparisonRow
                            label="Absolute threshold met"
                            modelValue={result.parsedOutput.absolute_threshold_met}
                            expectedValue={referenceChecks.absoluteThresholdMet}
                          />
                          <BooleanComparisonRow
                            label="PCT decline criterion met"
                            modelValue={result.parsedOutput.pct_decline_threshold_met}
                            expectedValue={referenceChecks.pctDeclineCriterionMet}
                          />
                          <BooleanComparisonRow
                            label="Clinical improvement present"
                            modelValue={result.parsedOutput.clinical_improvement_present}
                            expectedValue={referenceChecks.clinicalImprovementPresent}
                          />
                          <BooleanComparisonRow
                            label="Exclusion present"
                            modelValue={result.parsedOutput.exclusion_condition_present}
                            expectedValue={referenceChecks.exclusionConditionPresent}
                          />
                          <BooleanComparisonRow
                            label="Discontinuation gate passed"
                            modelValue={result.parsedOutput.safety_gate_passed}
                            expectedValue={referenceChecks.discontinuationGatePassed}
                          />
                        </div>
                      ) : null}

                      {referenceChecks ? (
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Calculation Audit Checks</p>
                          <BooleanComparisonRow
                            label="Current PCT <= threshold"
                            modelValue={result.parsedOutput.calculation_audit?.current_pct_less_or_equal_threshold}
                            expectedValue={referenceChecks.absoluteThresholdMet}
                          />
                          <BooleanComparisonRow
                            label="PCT decline >80%"
                            modelValue={result.parsedOutput.calculation_audit?.pct_decline_greater_than_80}
                            expectedValue={referenceChecks.pctDeclineCriterionMet}
                          />
                          <PercentComparisonRow
                            label="PCT decline %"
                            modelValue={result.parsedOutput.calculation_audit?.pct_decline_percent}
                            expectedValue={evaluationResponse.referenceDecision.pctDeclinePercent}
                          />
                        </div>
                      ) : null}

                      <div>
                        <p className="text-muted-foreground">Short Explanation</p>
                        <p className="mt-1 text-muted-foreground leading-relaxed">
                          {result.parsedOutput.reasoning_summary}
                        </p>
                      </div>

                      <div>
                        <p className="text-muted-foreground">Safety Warnings</p>
                        <p className="mt-1">
                          {result.parsedOutput.safety_warnings.length > 0
                            ? result.parsedOutput.safety_warnings.join(" | ")
                            : "N/A"}
                        </p>
                      </div>

                      {result.workflowTrace && result.workflowTrace.length > 0 ? (
                        <details className="rounded-md border border-border bg-muted/20 p-3">
                          <summary className="cursor-pointer text-sm font-medium text-foreground">
                            Technical trace
                          </summary>
                          <div className="mt-3 space-y-3">
                            {result.workflowTrace.map((step, index) => (
                              <div
                                key={`${result.configId}-${step.stepId}-${index}`}
                                className="rounded-md border border-border bg-background p-3"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-medium text-foreground">
                                    {index + 1}. {step.stepName}
                                  </p>
                                  <span className="text-xs text-muted-foreground">
                                    Parsed: {step.parsedSuccessfully ? "Yes" : "No"}
                                  </span>
                                </div>
                                <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-muted-foreground md:grid-cols-2">
                                  <p>Input source: {step.inputSource}</p>
                                  <p>Model: {step.modelId ?? "N/A"}</p>
                                  <p>Prompt: {step.promptTemplateId ?? "N/A"}</p>
                                  <p>
                                    Previous outputs:{" "}
                                    {step.includedStepOutputIds.length > 0
                                      ? step.includedStepOutputIds.join(", ")
                                      : "None"}
                                  </p>
                                </div>
                                <p className="mt-2 text-xs text-muted-foreground">{step.resolvedInputSummary}</p>
                                {step.outputPreview ? (
                                  <p className="mt-2 text-xs text-muted-foreground wrap-break-word">
                                    Output preview: {step.outputPreview}
                                  </p>
                                ) : null}
                                {step.error ? (
                                  <p className="mt-2 text-xs text-destructive wrap-break-word">Error: {step.error}</p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  ) : result.status === "error" ? (
                    <div className="space-y-1 text-sm">
                      <p className="font-medium text-destructive">{MODEL_FAILURE_MESSAGE}</p>
                      <p className="text-xs text-muted-foreground">{result.error || "Unknown error"}</p>
                    </div>
                  ) : null}
                </div>
                )
              })}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

