"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Header } from "@/components/dashboard/header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { benchmarkCases, type BenchmarkCase } from "@/lib/benchmark-cases"
import { DEFAULT_EVALUATION_WORKFLOWS } from "@/lib/evaluation-workflows"
import { DEFAULT_PROMPT_TEMPLATES, getDefaultPromptTemplate } from "@/lib/prompt-templates"
import type { EvaluationConfig, EvaluationWorkflow, PromptTemplate, WorkflowStep, WorkflowType } from "@/lib/types"
import { 
  Play, 
  Save, 
  Bot,
  CheckCircle2,
  Shield,
  Eye,
  AlertTriangle,
  RefreshCw
} from "lucide-react"

type OpenRouterModelOption = {
  id: string
  name: string
  provider: "openrouter" | "groq"
  contextLength: number | null
  promptPrice: string | null
  completionPrice: string | null
  isFree: boolean
  supportsStructuredOutput: boolean
  raw: unknown
}

type ModelsResponse = {
  models?: OpenRouterModelOption[]
  error?: string
}

type ModelTestResult = {
  modelId: string
  status: "available" | "failed"
  error?: string
  failureReason?: "needs_credits" | "provider_error" | "rate_limited" | "no_endpoint" | "unknown"
}

type ModelTestResponse = {
  results?: ModelTestResult[]
  error?: string
}

type PromptDraft = Pick<PromptTemplate, "name" | "description" | "text" | "expectedOutputSchema">

type ProviderId = "openrouter" | "groq"

type ProviderConnection = {
  key: string
  last4: string
  connectedAt: string
}

type ProviderApiKeys = Partial<Record<ProviderId, ProviderConnection>>

type ProviderTestResponse = {
  ok?: boolean
  error?: string
}

type ProviderFilter =
  | "all"
  | "openai"
  | "anthropic"
  | "google"
  | "meta"
  | "mistral"
  | "qwen"
  | "deepseek"
  | "other"

type BenchmarkCaseFilter =
  | "all"
  | "thermo"
  | "synthetic"
  | "lrti"
  | "sepsis_icu"
  | "safety_exceptions"
  | "threshold"
  | "missing_information"

type SortOption =
  | "free-first"
  | "lowest-input-cost"
  | "lowest-output-cost"
  | "highest-context"
  | "name-az"

const providerFilters: Array<{ value: ProviderFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
  { value: "meta", label: "Meta" },
  { value: "mistral", label: "Mistral" },
  { value: "qwen", label: "Qwen" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "other", label: "Other" },
]

const sortOptions: Array<{ value: SortOption; label: string }> = [
  { value: "free-first", label: "Free first" },
  { value: "lowest-input-cost", label: "Lowest input cost" },
  { value: "lowest-output-cost", label: "Lowest output cost" },
  { value: "highest-context", label: "Highest context length" },
  { value: "name-az", label: "Name A-Z" },
]

const benchmarkCaseFilters: Array<{ value: BenchmarkCaseFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "thermo", label: "Thermo Fisher adapted" },
  { value: "synthetic", label: "Synthetic algorithm cases" },
  { value: "lrti", label: "LRTI" },
  { value: "sepsis_icu", label: "Sepsis/ICU" },
  { value: "safety_exceptions", label: "Safety exceptions" },
  { value: "threshold", label: "Threshold cases" },
  { value: "missing_information", label: "Missing information" },
]

const visibleModelLimit = 30

const setupSections = [
  { id: "providers-models", label: "Providers & Models" },
  { id: "prompt-library", label: "Prompt Library" },
  { id: "workflow-builder", label: "Workflow Builder" },
  { id: "benchmark-cases", label: "Cases" },
  { id: "run-settings", label: "Run Settings" },
  { id: "configuration-summary", label: "Summary" },
] as const

const failureReasonLabels: Record<NonNullable<ModelTestResult["failureReason"]>, string> = {
  needs_credits: "needs credits",
  provider_error: "provider error",
  rate_limited: "rate limited",
  no_endpoint: "no endpoint",
  unknown: "unknown",
}

const evaluationCriteria = [
  { 
    id: "guideline", 
    name: "Guideline alignment", 
    description: "Adherence to PCT-guided antibiotic stewardship guidelines",
    icon: CheckCircle2
  },
  { 
    id: "explainability", 
    name: "Explainability", 
    description: "Clear reasoning and justification for recommendations",
    icon: Eye
  },
  { 
    id: "hallucination", 
    name: "Hallucination detection", 
    description: "Detection of fabricated or unsupported claims",
    icon: AlertTriangle
  },
  { 
    id: "safety", 
    name: "Safety risk detection", 
    description: "Identification of potentially harmful recommendations",
    icon: Shield
  },
  { 
    id: "robustness", 
    name: "Robustness across case variations", 
    description: "Consistency across similar clinical scenarios",
    icon: RefreshCw
  },
]

type EvaluationSettings = {
  providerId: ProviderId
  selectedModelIds: string[]
  defaultPromptTemplateId: string
  evaluationConfigs?: EvaluationConfig[]
  selectedWorkflowIds?: string[]
}

const workflowTypeOptions: Array<{ value: WorkflowType; label: string; description: string }> = [
  { value: "raw_baseline", label: "Raw baseline", description: "Baseline prompt with one selected model" },
  { value: "structured_prompt", label: "Structured prompt", description: "Structured JSON prompt with one selected model" },
  { value: "verification", label: "Verification workflow", description: "Primary model plus optional verifier model" },
  {
    value: "deterministic_precheck_explanation",
    label: "Deterministic precheck explanation",
    description: "Tool-assisted explanation of backend rule checks",
  },
]

const EVALUATION_SETTINGS_STORAGE_KEY = "evaluationSettings"
const PROVIDER_API_KEYS_STORAGE_KEY = "providerApiKeys"
const PROMPT_TEMPLATES_STORAGE_KEY = "promptTemplates"
const EVALUATION_WORKFLOWS_STORAGE_KEY = "evaluationWorkflows"
const DEFAULT_MODEL_ONLY_PROMPT_TEMPLATE_ID = "default-baseline-pct"

function mapLegacyPromptStrategyToTemplateId(value: unknown): string {
  if (value === "structured" || value === "json") return "default-structured-pct-json"
  if (value === "verification" || value === "multistep") return "default-verification-checklist"
  return DEFAULT_MODEL_ONLY_PROMPT_TEMPLATE_ID
}

function getDefaultTemplateIdForWorkflow(workflowType: WorkflowType): string {
  if (workflowType === "raw_baseline") return "default-baseline-pct"
  if (workflowType === "verification") return "default-verification-checklist"
  if (workflowType === "deterministic_precheck_explanation") return "default-deterministic-precheck-explanation"
  return "default-structured-pct-json"
}

function parsePromptTemplates(raw: string | null): PromptTemplate[] {
  if (!raw) return DEFAULT_PROMPT_TEMPLATES

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return DEFAULT_PROMPT_TEMPLATES

    const templates = parsed.filter((template): template is PromptTemplate => {
      if (!template || typeof template !== "object") return false
      const candidate = template as Partial<PromptTemplate>
      return (
        typeof candidate.id === "string" &&
        typeof candidate.name === "string" &&
        typeof candidate.description === "string" &&
        typeof candidate.text === "string" &&
        (candidate.expectedOutputSchema === "pct_json" ||
          candidate.expectedOutputSchema === "free_text" ||
          candidate.expectedOutputSchema === "verification_json") &&
        typeof candidate.isDefault === "boolean" &&
        typeof candidate.updatedAt === "string"
      )
    })

    const mergedDefaults = DEFAULT_PROMPT_TEMPLATES.map((defaultTemplate) => {
      return templates.find((template) => template.id === defaultTemplate.id) ?? defaultTemplate
    })
    const customTemplates = templates.filter((template) => !DEFAULT_PROMPT_TEMPLATES.some((item) => item.id === template.id))

    return [...mergedDefaults, ...customTemplates]
  } catch {
    return DEFAULT_PROMPT_TEMPLATES
  }
}

function parseEvaluationWorkflows(raw: string | null): EvaluationWorkflow[] {
  if (!raw) return DEFAULT_EVALUATION_WORKFLOWS
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return DEFAULT_EVALUATION_WORKFLOWS
    const workflows = parsed.filter((workflow): workflow is EvaluationWorkflow => {
      if (!workflow || typeof workflow !== "object") return false
      const candidate = workflow as Partial<EvaluationWorkflow>
      return (
        typeof candidate.id === "string" &&
        typeof candidate.name === "string" &&
        typeof candidate.description === "string" &&
        typeof candidate.isDefault === "boolean" &&
        Array.isArray(candidate.steps)
      )
    })
    const mergedDefaults = DEFAULT_EVALUATION_WORKFLOWS.map(
      (defaultWorkflow) => workflows.find((workflow) => workflow.id === defaultWorkflow.id) ?? defaultWorkflow,
    )
    const customWorkflows = workflows.filter(
      (workflow) => !DEFAULT_EVALUATION_WORKFLOWS.some((defaultWorkflow) => defaultWorkflow.id === workflow.id),
    )
    return [...mergedDefaults, ...customWorkflows]
  } catch {
    return DEFAULT_EVALUATION_WORKFLOWS
  }
}

function parseEvaluationSettings(raw: string | null): EvaluationSettings | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return null

    const maybe = parsed as Partial<EvaluationSettings> & {
      selectedModels?: unknown
      selectedStrategy?: unknown
      selectedPromptStrategy?: unknown
    }

    const rawSelectedModelIds = Array.isArray(maybe.selectedModelIds)
      ? maybe.selectedModelIds
      : Array.isArray(maybe.selectedModels)
        ? maybe.selectedModels
        : []
    const selectedModelIds = rawSelectedModelIds.filter((m): m is string => typeof m === "string")

    const defaultPromptTemplateId =
      typeof maybe.defaultPromptTemplateId === "string" && maybe.defaultPromptTemplateId.trim()
        ? maybe.defaultPromptTemplateId
        : mapLegacyPromptStrategyToTemplateId(
            typeof maybe.selectedPromptStrategy === "string"
              ? maybe.selectedPromptStrategy
              : maybe.selectedStrategy,
          )

    const providerId = maybe.providerId === "groq" ? "groq" : "openrouter"
    const evaluationConfigs = Array.isArray(maybe.evaluationConfigs)
      ? maybe.evaluationConfigs
          .filter((config): config is EvaluationConfig => {
            if (!config || typeof config !== "object") return false
            const candidate = config as Partial<EvaluationConfig>
            return (
              typeof candidate.configId === "string" &&
              typeof candidate.label === "string" &&
              (candidate.providerId === "openrouter" || candidate.providerId === "groq") &&
              workflowTypeOptions.some((option) => option.value === candidate.workflowType) &&
              Array.isArray(candidate.modelIds)
            )
          })
          .slice(0, 5)
      : []
    const selectedWorkflowIds = Array.isArray(maybe.selectedWorkflowIds)
      ? maybe.selectedWorkflowIds.filter((id): id is string => typeof id === "string")
      : DEFAULT_EVALUATION_WORKFLOWS.map((workflow) => workflow.id)

    return { providerId, selectedModelIds, defaultPromptTemplateId, evaluationConfigs, selectedWorkflowIds }
  } catch {
    return null
  }
}

function readPrice(value: string | null): number {
  if (value === null) return Number.POSITIVE_INFINITY
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

function formatPrice(value: string | null): string {
  const price = readPrice(value)
  if (!Number.isFinite(price)) return "pricing unknown"
  if (price === 0) return "$0"
  return `$${price}`
}

function getProviderKey(modelId: string): ProviderFilter {
  const provider = modelId.split("/")[0]?.toLowerCase() ?? ""

  if (provider === "openai") return "openai"
  if (provider === "anthropic") return "anthropic"
  if (provider === "google") return "google"
  if (provider === "meta" || provider === "meta-llama") return "meta"
  if (provider === "mistral" || provider === "mistralai") return "mistral"
  if (provider === "qwen") return "qwen"
  if (provider === "deepseek") return "deepseek"
  return "other"
}

function getProviderLabel(modelId: string): string {
  const providerKey = getProviderKey(modelId)
  return providerFilters.find((provider) => provider.value === providerKey)?.label ?? "Other"
}

function isFreeModel(model: OpenRouterModelOption): boolean {
  return model.isFree
}

function isTextOnlyModel(model: OpenRouterModelOption): boolean {
  const raw = model.raw && typeof model.raw === "object" && !Array.isArray(model.raw)
    ? (model.raw as { architecture?: { input_modalities?: unknown; output_modalities?: unknown } })
    : null
  const input = Array.isArray(raw?.architecture?.input_modalities)
    ? raw.architecture.input_modalities
    : ["text"]
  const output = Array.isArray(raw?.architecture?.output_modalities)
    ? raw.architecture.output_modalities
    : ["text"]
  return input.includes("text") && output.includes("text")
}

function isStructuredCapable(model: OpenRouterModelOption): boolean {
  return model.supportsStructuredOutput
}

function compareModelName(a: OpenRouterModelOption, b: OpenRouterModelOption): number {
  return (a.name || a.id).localeCompare(b.name || b.id)
}

function maskKey(last4: string): string {
  return `••••••••${last4}`
}

function parseProviderApiKeys(raw: string | null): ProviderApiKeys {
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return {}

    const maybe = parsed as Partial<Record<ProviderId, Partial<ProviderConnection>>>
    const next: ProviderApiKeys = {}

    for (const provider of ["openrouter", "groq"] as ProviderId[]) {
      const connection = maybe[provider]
      if (
        connection &&
        typeof connection.key === "string" &&
        typeof connection.last4 === "string" &&
        typeof connection.connectedAt === "string"
      ) {
        next[provider] = {
          key: connection.key,
          last4: connection.last4,
          connectedAt: connection.connectedAt,
        }
      }
    }

    return next
  } catch {
    return {}
  }
}

function saveProviderApiKeys(connections: ProviderApiKeys) {
  window.sessionStorage.setItem(PROVIDER_API_KEYS_STORAGE_KEY, JSON.stringify(connections))
}

function getProviderConnectionStatus(args: {
  hasMounted: boolean
  isConnected: boolean
}): string {
  if (!args.hasMounted) return "Loading session keys..."
  return args.isConnected ? "Connected" : "Not Connected"
}

function formatBenchmarkSourceType(sourceType: BenchmarkCase["sourceType"]): string {
  return sourceType === "thermo_case_adapted" ? "Thermo Fisher adapted" : "Synthetic algorithm case"
}

function benchmarkCaseMatchesFilter(benchmarkCase: BenchmarkCase, filter: BenchmarkCaseFilter): boolean {
  switch (filter) {
    case "all":
      return true
    case "thermo":
      return benchmarkCase.sourceType === "thermo_case_adapted"
    case "synthetic":
      return benchmarkCase.sourceType === "synthetic_algorithm_case"
    case "lrti":
      return benchmarkCase.tags.includes("lrti_non_icu") || benchmarkCase.caseData.infectionContext === "lrti_non_icu"
    case "sepsis_icu":
      return benchmarkCase.tags.includes("sepsis_icu") || benchmarkCase.caseData.infectionContext === "sepsis_icu"
    case "safety_exceptions":
      return benchmarkCase.tags.some((tag) => ["exception", "clinical_review_required", "renal_caution"].includes(tag))
    case "threshold":
      return benchmarkCase.tags.some((tag) =>
        ["low_pct", "current_pct_below_threshold", "borderline", "pct_decline_gt_80", "pct_decline_lt_80"].includes(tag),
      )
    case "missing_information":
      return benchmarkCase.tags.some((tag) =>
        ["missing_clinical_improvement", "missing_infection_context", "insufficient_information"].includes(tag),
      )
    default: {
      const _exhaustive: never = filter
      return _exhaustive
    }
  }
}

export default function EvaluationSetupPage() {
  const router = useRouter()
  const [hasMounted, setHasMounted] = useState(false)
  const [availableModels, setAvailableModels] = useState<OpenRouterModelOption[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId>("openrouter")
  const [evaluationConfigs, setEvaluationConfigs] = useState<EvaluationConfig[]>([])
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>(DEFAULT_PROMPT_TEMPLATES)
  const [promptTemplatesLoaded, setPromptTemplatesLoaded] = useState(false)
  const [evaluationWorkflows, setEvaluationWorkflows] = useState<EvaluationWorkflow[]>(DEFAULT_EVALUATION_WORKFLOWS)
  const [workflowsLoaded, setWorkflowsLoaded] = useState(false)
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>(
    DEFAULT_EVALUATION_WORKFLOWS.map((workflow) => workflow.id),
  )
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null)
  const [promptDraft, setPromptDraft] = useState<PromptDraft>({
    name: "",
    description: "",
    text: "",
    expectedOutputSchema: "pct_json",
  })
  const [modelSearch, setModelSearch] = useState("")
  const [freeOnly, setFreeOnly] = useState(true)
  const [textOnly, setTextOnly] = useState(true)
  const [structuredOnly, setStructuredOnly] = useState(false)
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all")
  const [sortOption, setSortOption] = useState<SortOption>("free-first")
  const [modelTestResults, setModelTestResults] = useState<Record<string, ModelTestResult>>({})
  const [modelsTesting, setModelsTesting] = useState(false)
  const [modelTestError, setModelTestError] = useState<string | null>(null)
  const [providerApiKeys, setProviderApiKeys] = useState<ProviderApiKeys>({})
  const [providerInputs, setProviderInputs] = useState<Record<ProviderId, string>>({
    openrouter: "",
    groq: "",
  })
  const [providerTesting, setProviderTesting] = useState<ProviderId | null>(null)
  const [providerTestStatus, setProviderTestStatus] = useState<Partial<Record<ProviderId, string>>>({})
  const [defaultPromptTemplateId, setDefaultPromptTemplateId] = useState(DEFAULT_MODEL_ONLY_PROMPT_TEMPLATE_ID)
  const [selectedCriteria, setSelectedCriteria] = useState<string[]>(["guideline", "explainability", "safety"])
  const [numberOfCases, setNumberOfCases] = useState("10")
  const [batchRun, setBatchRun] = useState(true)
  const [storeOutputs, setStoreOutputs] = useState(true)
  const [generateReport, setGenerateReport] = useState(true)
  const [batchDelayMs, setBatchDelayMs] = useState("2000")
  const [batchMaxRetries, setBatchMaxRetries] = useState("2")
  const [benchmarkCaseFilter, setBenchmarkCaseFilter] = useState<BenchmarkCaseFilter>("all")
  const [selectedBenchmarkCaseIds, setSelectedBenchmarkCaseIds] = useState<string[]>(
    benchmarkCases.map((benchmarkCase) => benchmarkCase.id),
  )
  const [benchmarkRunning, setBenchmarkRunning] = useState(false)
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null)

  useEffect(() => {
    setHasMounted(true)
  }, [])

  useEffect(() => {
    if (!hasMounted) return

    setPromptTemplates(parsePromptTemplates(window.localStorage.getItem(PROMPT_TEMPLATES_STORAGE_KEY)))
    setPromptTemplatesLoaded(true)
    setEvaluationWorkflows(parseEvaluationWorkflows(window.localStorage.getItem(EVALUATION_WORKFLOWS_STORAGE_KEY)))
    setWorkflowsLoaded(true)

    const existing = parseEvaluationSettings(window.localStorage.getItem(EVALUATION_SETTINGS_STORAGE_KEY))
    if (!existing) return

    const nextModels = existing.selectedModelIds.slice(0, 3)

    setSelectedProviderId(existing.providerId)
    if (nextModels.length > 0) setSelectedModels(nextModels)
    setDefaultPromptTemplateId(existing.defaultPromptTemplateId)
    setEvaluationConfigs(existing.evaluationConfigs ?? [])
    setSelectedWorkflowIds(existing.selectedWorkflowIds ?? DEFAULT_EVALUATION_WORKFLOWS.map((workflow) => workflow.id))
  }, [hasMounted])

  useEffect(() => {
    if (!hasMounted || !promptTemplatesLoaded) return

    try {
      window.localStorage.setItem(PROMPT_TEMPLATES_STORAGE_KEY, JSON.stringify(promptTemplates))
    } catch {
      // ignore localStorage write errors
    }
  }, [hasMounted, promptTemplates, promptTemplatesLoaded])

  useEffect(() => {
    if (!hasMounted || !promptTemplatesLoaded) return
    if (promptTemplates.some((template) => template.id === defaultPromptTemplateId)) return
    setDefaultPromptTemplateId(DEFAULT_MODEL_ONLY_PROMPT_TEMPLATE_ID)
  }, [defaultPromptTemplateId, hasMounted, promptTemplates, promptTemplatesLoaded])

  useEffect(() => {
    if (!hasMounted || !workflowsLoaded) return
    try {
      window.localStorage.setItem(EVALUATION_WORKFLOWS_STORAGE_KEY, JSON.stringify(evaluationWorkflows))
    } catch {
      // ignore localStorage write errors
    }
  }, [evaluationWorkflows, hasMounted, workflowsLoaded])

  useEffect(() => {
    if (!hasMounted) return

    setProviderApiKeys(parseProviderApiKeys(window.sessionStorage.getItem(PROVIDER_API_KEYS_STORAGE_KEY)))
  }, [hasMounted])

  useEffect(() => {
    if (!hasMounted) return

    const settings: EvaluationSettings = {
      providerId: selectedProviderId,
      selectedModelIds: selectedModels,
      defaultPromptTemplateId,
      evaluationConfigs,
      selectedWorkflowIds,
    }
    try {
      window.localStorage.setItem(EVALUATION_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // ignore localStorage write errors (e.g., storage disabled)
    }
  }, [defaultPromptTemplateId, evaluationConfigs, hasMounted, selectedModels, selectedProviderId, selectedWorkflowIds])

  const refreshModels = async () => {
    if (!hasMounted) return

    setModelsLoading(true)
    setModelsError(null)

    try {
      const providerKey = providerApiKeys[selectedProviderId]?.key
      if (!providerKey) {
        throw new Error("Connect an API key for this provider first.")
      }

      const response = await fetch("/api/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId: selectedProviderId,
          apiKey: providerKey,
        }),
      })
      const json = (await response.json()) as ModelsResponse

      if (!response.ok) {
        throw new Error(json.error || `Failed to load models with status ${response.status}`)
      }

      setAvailableModels(json.models ?? [])
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown model refresh error"
      setModelsError(message)
      setAvailableModels([])
    } finally {
      setModelsLoading(false)
    }
  }

  const toggleModel = (modelId: string) => {
    setSelectedModels(prev => {
      if (prev.includes(modelId)) {
        return prev.filter(id => id !== modelId)
      }

      if (prev.length >= 3) {
        return prev
      }

      return [...prev, modelId]
    })
    setModelTestError(null)
  }

  const changeSelectedProvider = (providerId: ProviderId) => {
    setSelectedProviderId(providerId)
    setSelectedModels([])
    setEvaluationConfigs([])
    setAvailableModels([])
    setModelTestResults({})
    setModelsError(null)
  }

  const toggleCriteria = (criteriaId: string) => {
    setSelectedCriteria(prev => 
      prev.includes(criteriaId) 
        ? prev.filter(id => id !== criteriaId)
        : [...prev, criteriaId]
    )
  }

  const testSelectedModels = async () => {
    if (!hasMounted) return
    if (selectedModels.length === 0) return

    setModelsTesting(true)
    setModelTestError(null)

    try {
      const response = await fetch("/api/models/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          modelIds: selectedModels,
          apiKey: providerApiKeys.openrouter?.key,
        }),
      })
      const json = (await response.json()) as ModelTestResponse

      if (!response.ok) {
        throw new Error(json.error || `Model test failed with status ${response.status}`)
      }

      const nextResults: Record<string, ModelTestResult> = {}
      for (const result of json.results ?? []) {
        nextResults[result.modelId] = result
      }
      setModelTestResults(nextResults)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown model test error"
      setModelTestError(message)
    } finally {
      setModelsTesting(false)
    }
  }

  const saveProviderKey = (provider: ProviderId) => {
    if (!hasMounted) return

    const key = providerInputs[provider].trim()
    if (!key) return

    const nextConnections: ProviderApiKeys = {
      ...providerApiKeys,
      [provider]: {
        key,
        last4: key.slice(-4),
        connectedAt: new Date().toISOString(),
      },
    }

    setProviderApiKeys(nextConnections)
    saveProviderApiKeys(nextConnections)
    setProviderInputs((current) => ({ ...current, [provider]: "" }))
    setProviderTestStatus((current) => ({ ...current, [provider]: "Saved for this browser session." }))
  }

  const removeProviderKey = (provider: ProviderId) => {
    if (!hasMounted) return

    const nextConnections: ProviderApiKeys = { ...providerApiKeys }
    delete nextConnections[provider]

    setProviderApiKeys(nextConnections)
    saveProviderApiKeys(nextConnections)
    setProviderInputs((current) => ({ ...current, [provider]: "" }))
    setProviderTestStatus((current) => ({ ...current, [provider]: "Removed." }))
  }

  const testProviderConnection = async (provider: ProviderId) => {
    if (!hasMounted) return

    const apiKey = providerApiKeys[provider]?.key || providerInputs[provider].trim()
    if (!apiKey) {
      setProviderTestStatus((current) => ({ ...current, [provider]: "Add a key before testing." }))
      return
    }

    setProviderTesting(provider)
    setProviderTestStatus((current) => ({ ...current, [provider]: "Testing..." }))

    try {
      const response = await fetch("/api/providers/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ provider, apiKey }),
      })
      const json = (await response.json()) as ProviderTestResponse

      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Connection test failed with status ${response.status}`)
      }

      setProviderTestStatus((current) => ({ ...current, [provider]: "Connection test passed." }))
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection test failed."
      setProviderTestStatus((current) => ({ ...current, [provider]: message }))
    } finally {
      setProviderTesting(null)
    }
  }

  const filteredModels = useMemo(() => {
    const search = modelSearch.trim().toLowerCase()

    const filtered = availableModels.filter((model) => {
      const matchesSearch =
        !search ||
        model.id.toLowerCase().includes(search) ||
        (model.name || "").toLowerCase().includes(search)

      if (!matchesSearch) return false
      if (freeOnly && !isFreeModel(model)) return false
      if (textOnly && !isTextOnlyModel(model)) return false
      if (structuredOnly && !isStructuredCapable(model)) return false
      if (providerFilter !== "all" && getProviderKey(model.id) !== providerFilter) return false

      return true
    })

    return [...filtered].sort((a, b) => {
      switch (sortOption) {
        case "free-first": {
          const freeDelta = Number(isFreeModel(b)) - Number(isFreeModel(a))
          return freeDelta || readPrice(a.promptPrice) - readPrice(b.promptPrice) || compareModelName(a, b)
        }
        case "lowest-input-cost":
          return readPrice(a.promptPrice) - readPrice(b.promptPrice) || compareModelName(a, b)
        case "lowest-output-cost":
          return readPrice(a.completionPrice) - readPrice(b.completionPrice) || compareModelName(a, b)
        case "highest-context":
          return (b.contextLength ?? 0) - (a.contextLength ?? 0) || compareModelName(a, b)
        case "name-az":
          return compareModelName(a, b)
        default: {
          const _exhaustive: never = sortOption
          return _exhaustive
        }
      }
    })
  }, [availableModels, freeOnly, modelSearch, providerFilter, sortOption, structuredOnly, textOnly])

  const filteredBenchmarkCases = useMemo(() => {
    return benchmarkCases.filter((benchmarkCase) =>
      benchmarkCaseMatchesFilter(benchmarkCase, benchmarkCaseFilter),
    )
  }, [benchmarkCaseFilter])

  const toggleBenchmarkCase = (caseId: string) => {
    setSelectedBenchmarkCaseIds((current) =>
      current.includes(caseId)
        ? current.filter((id) => id !== caseId)
        : [...current, caseId],
    )
  }

  const selectAllVisibleBenchmarkCases = () => {
    setSelectedBenchmarkCaseIds((current) =>
      Array.from(new Set([...current, ...filteredBenchmarkCases.map((benchmarkCase) => benchmarkCase.id)])),
    )
  }

  const clearBenchmarkCaseSelection = () => {
    setSelectedBenchmarkCaseIds([])
  }

  const getConfigPromptStrategy = (workflowType: WorkflowType): string => {
    if (workflowType === "raw_baseline") return "baseline"
    if (workflowType === "verification") return "verification"
    return "structured"
  }

  const addEvaluationConfig = (workflowType: WorkflowType) => {
    const primaryModelId = selectedModels[0] ?? availableModels[0]?.id
    if (!primaryModelId) {
      setModelsError("Refresh models and select at least one model before adding an evaluation configuration.")
      return
    }

    setEvaluationConfigs((current) => {
      if (current.length >= 5) return current
      const option = workflowTypeOptions.find((item) => item.value === workflowType)
      const suffix = current.length + 1
      const modelIds =
        workflowType === "verification" && selectedModels[1]
          ? [primaryModelId, selectedModels[1]]
          : [primaryModelId]
      const promptTemplateId = getDefaultTemplateIdForWorkflow(workflowType)
      const promptTemplate = promptTemplates.find((template) => template.id === promptTemplateId)

      return [
        ...current,
        {
          configId: `${selectedProviderId}-${workflowType}-${Date.now()}-${suffix}`,
          label: option?.label ?? `Evaluation config ${suffix}`,
          providerId: selectedProviderId,
          workflowType,
          modelIds,
          promptStrategy: getConfigPromptStrategy(workflowType),
          promptTemplateId,
          promptTemplateText: promptTemplate?.text,
        },
      ]
    })
  }

  const updateEvaluationConfig = (configId: string, patch: Partial<EvaluationConfig>) => {
    setEvaluationConfigs((current) =>
      current.map((config) => {
        if (config.configId !== configId) return config
        const nextWorkflowType = patch.workflowType ?? config.workflowType
        const nextModelIds = patch.modelIds ?? config.modelIds
        const nextPromptTemplateId =
          patch.promptTemplateId ?? (patch.workflowType ? getDefaultTemplateIdForWorkflow(nextWorkflowType) : config.promptTemplateId)
        const nextPromptTemplateText =
          patch.promptTemplateText ??
          (patch.workflowType ? getPromptTemplateText(nextPromptTemplateId) : config.promptTemplateText)

        return {
          ...config,
          ...patch,
          workflowType: nextWorkflowType,
          promptStrategy: getConfigPromptStrategy(nextWorkflowType),
          modelIds: nextWorkflowType === "verification" ? nextModelIds.slice(0, 2) : nextModelIds.slice(0, 1),
          promptTemplateId: nextPromptTemplateId,
          promptTemplateText: nextPromptTemplateText,
        }
      }),
    )
  }

  const removeEvaluationConfig = (configId: string) => {
    setEvaluationConfigs((current) => current.filter((config) => config.configId !== configId))
  }

  const emptyPromptDraft: PromptDraft = {
    name: "",
    description: "",
    text: "",
    expectedOutputSchema: "pct_json",
  }

  const startEditingPrompt = (template: PromptTemplate) => {
    setEditingPromptId(template.id)
    setPromptDraft({
      name: template.name,
      description: template.description,
      text: template.text,
      expectedOutputSchema: template.expectedOutputSchema,
    })
  }

  const addPromptTemplate = () => {
    const now = new Date().toISOString()
    const template: PromptTemplate = {
      id: `custom-prompt-${Date.now()}`,
      name: "New Prompt",
      description: "",
      text: "",
      expectedOutputSchema: "pct_json",
      isDefault: false,
      updatedAt: now,
    }
    setPromptTemplates((current) => [...current, template])
    startEditingPrompt(template)
  }

  const savePromptTemplate = () => {
    if (!editingPromptId) return

    setPromptTemplates((current) =>
      current.map((template) =>
        template.id === editingPromptId
          ? {
              ...template,
              name: promptDraft.name.trim() || "Untitled Prompt",
              description: promptDraft.description,
              expectedOutputSchema: promptDraft.expectedOutputSchema,
              text: promptDraft.text,
              updatedAt: new Date().toISOString(),
            }
          : template,
      ),
    )
    setEvaluationConfigs((current) =>
      current.map((config) =>
        config.promptTemplateId === editingPromptId ? { ...config, promptTemplateText: promptDraft.text } : config,
      ),
    )
    setEvaluationWorkflows((current) =>
      current.map((workflow) => ({
        ...workflow,
        steps: workflow.steps.map((step) =>
          step.promptTemplateId === editingPromptId ? { ...step, promptTemplateText: promptDraft.text } : step,
        ),
      })),
    )
    setEditingPromptId(null)
    setPromptDraft(emptyPromptDraft)
  }

  const duplicatePromptTemplate = (template: PromptTemplate) => {
    const copy: PromptTemplate = {
      ...template,
      id: `custom-${template.id}-${Date.now()}`,
      name: `${template.name} copy`,
      isDefault: false,
      updatedAt: new Date().toISOString(),
    }
    setPromptTemplates((current) => [...current, copy])
    startEditingPrompt(copy)
  }

  const deletePromptTemplate = (templateId: string) => {
    const template = promptTemplates.find((item) => item.id === templateId)
    if (!template || template.isDefault) return

    setPromptTemplates((current) => current.filter((item) => item.id !== templateId))
    setEvaluationConfigs((current) =>
      current.map((config) =>
        config.promptTemplateId === templateId
          ? {
              ...config,
              promptTemplateId: getDefaultTemplateIdForWorkflow(config.workflowType),
              promptTemplateText: getPromptTemplateText(getDefaultTemplateIdForWorkflow(config.workflowType)),
            }
          : config,
      ),
    )
    setEvaluationWorkflows((current) =>
      current.map((workflow) => ({
        ...workflow,
        steps: workflow.steps.map((step) =>
          step.promptTemplateId === templateId
            ? { ...step, promptTemplateId: promptTemplates[0]?.id, promptTemplateText: promptTemplates[0]?.text }
            : step,
        ),
      })),
    )
    if (editingPromptId === templateId) {
      setEditingPromptId(null)
      setPromptDraft(emptyPromptDraft)
    }
    if (defaultPromptTemplateId === templateId) {
      setDefaultPromptTemplateId(DEFAULT_MODEL_ONLY_PROMPT_TEMPLATE_ID)
    }
  }

  const resetDefaultPromptTemplate = (templateId: string) => {
    const defaultTemplate = getDefaultPromptTemplate(templateId)
    if (!defaultTemplate) return

    setPromptTemplates((current) =>
      current.map((template) => (template.id === templateId ? { ...defaultTemplate, updatedAt: new Date().toISOString() } : template)),
    )
    setEvaluationConfigs((current) =>
      current.map((config) =>
        config.promptTemplateId === templateId
          ? { ...config, promptTemplateText: defaultTemplate.text }
          : config,
      ),
    )
  }

  const getPromptTemplateText = (templateId: string | undefined): string | undefined => {
    if (!templateId) return undefined
    return promptTemplates.find((template) => template.id === templateId)?.text
  }

  const hydrateConfigsWithPromptTemplates = (configs: EvaluationConfig[]): EvaluationConfig[] => {
    return configs.map((config) => ({
      ...config,
      promptTemplateText: getPromptTemplateText(config.promptTemplateId) ?? config.promptTemplateText,
    }))
  }

  const hydrateWorkflowsForRun = (workflows: EvaluationWorkflow[]): EvaluationWorkflow[] => {
    return workflows.map((workflow) => ({
      ...workflow,
      steps: workflow.steps.map((step, index) => {
        const isModelStep =
          step.stepType === "llm_call" ||
          step.stepType === "verification" ||
          step.stepType === "final_report"
        const fallbackModelId =
          step.stepType === "verification"
            ? selectedModels[1] ?? selectedModels[0] ?? availableModels[0]?.id
            : selectedModels[index] ?? selectedModels[0] ?? availableModels[0]?.id

        return {
          ...step,
          modelId: step.modelId ?? (isModelStep ? fallbackModelId : undefined),
          promptTemplateText: getPromptTemplateText(step.promptTemplateId) ?? step.promptTemplateText,
        }
      }),
    }))
  }

  const validateEnabledWorkflows = (workflows: EvaluationWorkflow[]): string | null => {
    for (const workflow of workflows) {
      if (workflow.steps.length === 0) {
        return `${workflow.name || "Workflow"} needs at least one step.`
      }

      for (const step of workflow.steps) {
        const needsModel =
          step.stepType === "llm_call" ||
          step.stepType === "verification" ||
          step.stepType === "final_report"
        if (!needsModel) continue

        if (!step.modelId) {
          return `${workflow.name || "Workflow"} / ${step.name || step.stepType} needs a model.`
        }
        if (!step.promptTemplateId) {
          return `${workflow.name || "Workflow"} / ${step.name || step.stepType} needs a prompt template.`
        }
      }
    }

    return null
  }

  const getDefaultModelId = (): string | undefined => selectedModels[0] ?? availableModels[0]?.id

  const toggleWorkflowSelection = (workflowId: string) => {
    setSelectedWorkflowIds((current) =>
      current.includes(workflowId) ? current.filter((id) => id !== workflowId) : [...current, workflowId],
    )
  }

  const duplicateWorkflow = (workflow: EvaluationWorkflow) => {
    const copy: EvaluationWorkflow = {
      ...workflow,
      id: `custom-${workflow.id}-${Date.now()}`,
      name: `${workflow.name} copy`,
      isDefault: false,
      steps: workflow.steps.map((step) => ({ ...step, id: `${step.id}-${Date.now()}` })),
    }
    setEvaluationWorkflows((current) => [...current, copy].slice(0, 5))
    setSelectedWorkflowIds((current) => [...current, copy.id])
  }

  const addWorkflow = () => {
    const modelId = getDefaultModelId()
    const workflow: EvaluationWorkflow = {
      id: `custom-workflow-${Date.now()}`,
      name: "New Workflow",
      description: "",
      isDefault: false,
      steps: [
        {
          id: `custom-step-${Date.now()}`,
          name: "Step 1",
          stepType: "llm_call",
          modelId,
          promptTemplateId: promptTemplates[0]?.id ?? "default-structured-pct-json",
          inputSource: "case_data",
        },
      ],
    }
    setEvaluationWorkflows((current) => [...current, workflow].slice(0, 5))
    setSelectedWorkflowIds((current) => [...current, workflow.id])
  }

  const deleteWorkflow = (workflowId: string) => {
    const workflow = evaluationWorkflows.find((item) => item.id === workflowId)
    if (!workflow || workflow.isDefault) return

    setEvaluationWorkflows((current) => current.filter((item) => item.id !== workflowId))
    setSelectedWorkflowIds((current) => current.filter((id) => id !== workflowId))
  }

  const updateWorkflow = (workflowId: string, patch: Partial<EvaluationWorkflow>) => {
    setEvaluationWorkflows((current) =>
      current.map((workflow) => (workflow.id === workflowId ? { ...workflow, ...patch } : workflow)),
    )
  }

  const updateWorkflowStep = (workflowId: string, stepId: string, patch: Partial<WorkflowStep>) => {
    setEvaluationWorkflows((current) =>
      current.map((workflow) =>
        workflow.id === workflowId
          ? {
              ...workflow,
              steps: workflow.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
            }
          : workflow,
      ),
    )
  }

  const addWorkflowStep = (workflowId: string) => {
    setEvaluationWorkflows((current) =>
      current.map((workflow) =>
        workflow.id === workflowId && workflow.steps.length < 5
          ? {
              ...workflow,
              steps: [
                ...workflow.steps,
                {
                  id: `step-${Date.now()}`,
                  name: "New step",
                  stepType: "llm_call",
                  modelId: getDefaultModelId(),
                  promptTemplateId: "default-structured-pct-json",
                  inputSource: workflow.steps.length === 0 ? "case_data" : "previous_step",
                },
              ],
            }
          : workflow,
      ),
    )
  }

  const removeWorkflowStep = (workflowId: string, stepId: string) => {
    setEvaluationWorkflows((current) =>
      current.map((workflow) =>
        workflow.id === workflowId
          ? { ...workflow, steps: workflow.steps.filter((step) => step.id !== stepId) }
          : workflow,
      ),
    )
  }

  const moveWorkflowStep = (workflowId: string, stepId: string, direction: -1 | 1) => {
    setEvaluationWorkflows((current) =>
      current.map((workflow) => {
        if (workflow.id !== workflowId) return workflow
        const index = workflow.steps.findIndex((step) => step.id === stepId)
        const nextIndex = index + direction
        if (index < 0 || nextIndex < 0 || nextIndex >= workflow.steps.length) return workflow
        const steps = [...workflow.steps]
        const [step] = steps.splice(index, 1)
        steps.splice(nextIndex, 0, step)
        return { ...workflow, steps }
      }),
    )
  }

  const runBenchmark = async () => {
    if (!hasMounted || benchmarkRunning) return

    setBenchmarkRunning(true)
    setBenchmarkError(null)

    try {
      const providerId = selectedProviderId
      const selectedIdsForRun = selectedWorkflowIds
      const workflowsForRun = hydrateWorkflowsForRun(
        evaluationWorkflows.filter((workflow) => selectedIdsForRun.includes(workflow.id)),
      )
      const workflowValidationError = workflowsForRun.length > 0 ? validateEnabledWorkflows(workflowsForRun) : null
      if (workflowValidationError) {
        throw new Error(workflowValidationError)
      }
      const selectedModelIds = workflowsForRun.length > 0 ? [] : selectedModels
      const configsForRun = hydrateConfigsWithPromptTemplates(evaluationConfigs)
      const workflowPromptTemplateIds = new Set(
        workflowsForRun.flatMap((workflow) =>
          workflow.steps
            .map((step) => step.promptTemplateId)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      )
      if (workflowsForRun.length === 0) workflowPromptTemplateIds.add(defaultPromptTemplateId)
      const promptTemplatesForRun = promptTemplates.filter((template) => workflowPromptTemplateIds.has(template.id))
      const defaultPromptTemplate =
        promptTemplates.find((template) => template.id === defaultPromptTemplateId) ??
        promptTemplates.find((template) => template.id === DEFAULT_MODEL_ONLY_PROMPT_TEMPLATE_ID) ??
        DEFAULT_PROMPT_TEMPLATES[0]
      const apiKey = providerApiKeys[providerId]?.key
      const delayNumber = Number(batchDelayMs)
      const retryNumber = Number(batchMaxRetries)
      const delayMs = Number.isFinite(delayNumber) ? Math.max(0, Math.round(delayNumber)) : 2000
      const maxRetries = Number.isFinite(retryNumber) ? Math.min(Math.max(0, Math.round(retryNumber)), 5) : 2

      if (!apiKey) {
        throw new Error("Connect an API key for the selected provider first.")
      }

      const response = await fetch("/api/batch-evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          apiKey,
          selectedModelIds,
          evaluationConfigs: configsForRun,
          evaluationWorkflows: workflowsForRun,
          promptTemplates: promptTemplatesForRun,
          defaultPromptTemplateId: defaultPromptTemplate.id,
          defaultPromptTemplateText: defaultPromptTemplate.text,
          caseIds: selectedBenchmarkCaseIds,
          delayMs,
          maxRetries,
        }),
      })
      const json = await response.json()

      if (!response.ok) {
        throw new Error(json?.error || `Benchmark failed with status ${response.status}`)
      }

      window.sessionStorage.setItem("latestBatchEvaluationResponse", JSON.stringify(json))
      router.push("/benchmark-results")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown benchmark error"
      setBenchmarkError(message)
    } finally {
      setBenchmarkRunning(false)
    }
  }

  const visibleModels = filteredModels.slice(0, visibleModelLimit)
  const hasFailedSelectedModels = selectedModels.some(
    (modelId) => modelTestResults[modelId]?.status === "failed",
  )
  const selectedProviderLabel = selectedProviderId === "openrouter" ? "OpenRouter" : "Groq"
  const summaryDelayNumber = Number(batchDelayMs)
  const summaryRetryNumber = Number(batchMaxRetries)
  const summaryDelayMs = Number.isFinite(summaryDelayNumber) ? Math.max(0, Math.round(summaryDelayNumber)) : 2000
  const summaryMaxRetries = Number.isFinite(summaryRetryNumber)
    ? Math.min(Math.max(0, Math.round(summaryRetryNumber)), 5)
    : 2

  if (!hasMounted) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar activePage="Evaluation Setup" />

        <div className="flex-1 flex flex-col overflow-hidden">
          <Header
            title="Evaluation Setup"
            description="Configure LLMs and evaluation parameters for benchmark testing"
          />

          <main className="flex-1 overflow-y-auto p-6">
            <div className="max-w-7xl space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Loading Evaluation Setup</CardTitle>
                  <CardDescription>Loading session keys, saved prompts, workflows, and settings.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm font-medium text-foreground">Provider connections</p>
                    <p className="mt-1 text-sm text-muted-foreground">Loading session keys...</p>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm font-medium text-foreground">Configuration controls</p>
                    <p className="mt-1 text-sm text-muted-foreground">Preparing model, prompt, workflow, case, and run settings.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar activePage="Evaluation Setup" />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header 
          title="Evaluation Setup" 
          description="Configure LLMs and evaluation parameters for benchmark testing"
        />
        
        <main className="flex-1 overflow-y-auto p-6">
          <div className="sticky top-0 z-20 -mx-6 mb-6 border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
            <nav className="flex max-w-7xl gap-2 overflow-x-auto" aria-label="Evaluation setup sections">
              {setupSections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="shrink-0 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {section.label}
                </a>
              ))}
            </nav>
          </div>

          <div id="providers-models" className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-7xl scroll-mt-24">
            {/* Left Column */}
            <div className="space-y-6">
              {/* Model Selection */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Model Selection</CardTitle>
                      <CardDescription>Choose 1-3 {selectedProviderLabel} models for the single-case evaluation</CardDescription>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2 shrink-0"
                      onClick={refreshModels}
                      disabled={Boolean(!hasMounted || modelsLoading)}
                    >
                      <RefreshCw className={`w-4 h-4 ${modelsLoading ? "animate-spin" : ""}`} />
                      Refresh Models
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 space-y-1.5">
                    <Label htmlFor="modelProvider" className="text-xs text-muted-foreground">Provider</Label>
                    <select
                      id="modelProvider"
                      value={selectedProviderId}
                      onChange={(event) => changeSelectedProvider(event.target.value as ProviderId)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="openrouter">OpenRouter</option>
                      <option value="groq">Groq</option>
                    </select>
                  </div>

                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge variant={selectedModels.length >= 1 && selectedModels.length <= 3 ? "secondary" : "outline"}>
                      {selectedModels.length}/3 selected
                    </Badge>
                    {selectedModels.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        No custom models selected. The API will use predefined free fallback configs.
                      </span>
                    ) : null}
                  </div>

                  {modelsError ? (
                    <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                      <p className="text-sm font-medium text-destructive">Could not refresh models</p>
                      <p className="text-sm text-muted-foreground mt-1">{modelsError}</p>
                    </div>
                  ) : null}

                  <div className="mb-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
                    <p className="text-sm text-warning-foreground">
                      Paid models may fail if your OpenRouter account has no credits. Use Free Only or add credits.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Free models may still fail because of provider availability or rate limits. Use Test Selected Models before running evaluation.
                    </p>
                  </div>

                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={testSelectedModels}
                      disabled={Boolean(!hasMounted || modelsTesting || selectedModels.length === 0)}
                    >
                      <RefreshCw className={`w-4 h-4 ${modelsTesting ? "animate-spin" : ""}`} />
                      Test Selected Models
                    </Button>
                    {modelTestError ? (
                      <span className="text-xs text-destructive">{modelTestError}</span>
                    ) : null}
                    {hasFailedSelectedModels ? (
                      <span className="text-xs text-destructive">
                        Some models failed. Refresh models or choose different free models.
                      </span>
                    ) : null}
                  </div>

                  <div className="mb-4 space-y-3">
                    <Input
                      value={modelSearch}
                      onChange={(event) => setModelSearch(event.target.value)}
                      placeholder="Search by model name or ID"
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="providerFilter" className="text-xs text-muted-foreground">Provider</Label>
                        <select
                          id="providerFilter"
                          value={providerFilter}
                          onChange={(event) => setProviderFilter(event.target.value as ProviderFilter)}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {providerFilters.map((provider) => (
                            <option key={provider.value} value={provider.value}>{provider.label}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="sortModels" className="text-xs text-muted-foreground">Sort</Label>
                        <select
                          id="sortModels"
                          value={sortOption}
                          onChange={(event) => setSortOption(event.target.value as SortOption)}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {sortOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="flex items-center justify-between rounded-lg border border-border p-3">
                        <Label htmlFor="freeOnly" className="text-sm">Free models only</Label>
                        <Switch id="freeOnly" checked={freeOnly} onCheckedChange={setFreeOnly} />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-border p-3">
                        <Label htmlFor="textOnly" className="text-sm">Text-only models only</Label>
                        <Switch id="textOnly" checked={textOnly} onCheckedChange={setTextOnly} />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-border p-3">
                        <Label htmlFor="structuredOnly" className="text-sm">Structured-output capable only</Label>
                        <Switch id="structuredOnly" checked={structuredOnly} onCheckedChange={setStructuredOnly} />
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Showing {visibleModels.length} of {filteredModels.length} models
                      {availableModels.length !== filteredModels.length ? ` (${availableModels.length} total loaded)` : ""}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 max-h-[28rem] overflow-y-auto pr-1">
                    {visibleModels.map((model) => {
                      const isSelected = selectedModels.includes(model.id)
                      const provider = getProviderLabel(model.id)
                      const isFree = isFreeModel(model)
                      const isStructured = isStructuredCapable(model)
                      const testResult = modelTestResults[model.id]
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => toggleModel(model.id)}
                          disabled={Boolean(!hasMounted)}
                          className={`p-4 rounded-lg border-2 transition-all text-left ${
                            isSelected
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-muted-foreground/30"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                              isSelected ? "bg-primary/10" : "bg-muted"
                            }`}>
                              <Bot className={`w-5 h-5 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                            </div>
                            <div className="min-w-0">
                              <p className={`font-medium text-sm ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
                                {model.name || model.id}
                              </p>
                              <p className="text-xs text-muted-foreground break-all">{model.id}</p>
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                <span>Provider: {provider}</span>
                                <span>Context: {model.contextLength ?? "unknown"}</span>
                                <span>Input: {formatPrice(model.promptPrice)}</span>
                                <span>Output: {formatPrice(model.completionPrice)}</span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {isFree ? <Badge variant="outline" className="text-xs">Free</Badge> : null}
                                {isStructured ? <Badge variant="outline" className="text-xs">Structured</Badge> : null}
                                {testResult?.status === "available" ? (
                                  <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">
                                    Available
                                  </Badge>
                                ) : null}
                                {testResult?.status === "failed" ? (
                                  <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/30">
                                    Failed: {failureReasonLabels[testResult.failureReason ?? "unknown"]}
                                  </Badge>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {!modelsLoading && availableModels.length === 0 && !modelsError ? (
                    <p className="text-sm text-muted-foreground">
                      No models loaded yet. Refresh models to fetch the OpenRouter catalog.
                    </p>
                  ) : null}
                  {!modelsLoading && availableModels.length > 0 && filteredModels.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No models match the current filters.
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              {/* Workflow Builder */}
              <Card id="workflow-builder" className="scroll-mt-24">
                <CardHeader>
                  <CardTitle className="text-base">Workflow Builder</CardTitle>
                  <CardDescription>Create and compare 1-5 linear evaluation workflows</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    Each enabled workflow becomes one benchmark configuration.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addWorkflow}
                      disabled={Boolean(!hasMounted || evaluationWorkflows.length >= 5)}
                    >
                      Add Workflow
                    </Button>
                    <Badge variant="secondary">{selectedWorkflowIds.length} enabled</Badge>
                  </div>

                  <div className="space-y-3">
                    {evaluationWorkflows.map((workflow) => {
                      const isEnabled = selectedWorkflowIds.includes(workflow.id)

                      return (
                        <div key={workflow.id} className="rounded-lg border border-border p-4 space-y-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="space-y-2 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Switch checked={isEnabled} onCheckedChange={() => toggleWorkflowSelection(workflow.id)} />
                                <span className="text-xs text-muted-foreground">
                                  {isEnabled ? "Enabled" : "Disabled"}
                                </span>
                                <Input
                                  value={workflow.name}
                                  onChange={(event) => updateWorkflow(workflow.id, { name: event.target.value })}
                                  className="max-w-md"
                                />
                                {workflow.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                              </div>
                              <Input
                                value={workflow.description}
                                onChange={(event) => updateWorkflow(workflow.id, { description: event.target.value })}
                              />
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => duplicateWorkflow(workflow)}
                              disabled={Boolean(!hasMounted || evaluationWorkflows.length >= 5)}
                            >
                              Duplicate workflow
                            </Button>
                            {!workflow.isDefault ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => deleteWorkflow(workflow.id)}
                                disabled={Boolean(!hasMounted)}
                              >
                                Delete workflow
                              </Button>
                            ) : null}
                          </div>

                          <div className="space-y-3">
                            {workflow.steps.map((step, index) => (
                              <div key={step.id} className="rounded-md border border-border p-3 space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <Badge variant="outline">Step {index + 1}</Badge>
                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => moveWorkflowStep(workflow.id, step.id, -1)}
                                      disabled={Boolean(!hasMounted || index === 0)}
                                    >
                                      Up
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => moveWorkflowStep(workflow.id, step.id, 1)}
                                      disabled={Boolean(!hasMounted || index === workflow.steps.length - 1)}
                                    >
                                      Down
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => removeWorkflowStep(workflow.id, step.id)}
                                      disabled={Boolean(!hasMounted || workflow.steps.length <= 1)}
                                    >
                                      Remove
                                    </Button>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div className="space-y-2">
                                    <Label className="text-xs">Step name</Label>
                                    <Input
                                      value={step.name}
                                      onChange={(event) => updateWorkflowStep(workflow.id, step.id, { name: event.target.value })}
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label className="text-xs">Step type</Label>
                                    <select
                                      value={step.stepType}
                                      onChange={(event) =>
                                        updateWorkflowStep(workflow.id, step.id, {
                                          stepType: event.target.value as WorkflowStep["stepType"],
                                        })
                                      }
                                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                      <option value="llm_call">LLM call</option>
                                      <option value="deterministic_precheck">Deterministic precheck</option>
                                      <option value="verification">Verification</option>
                                      <option value="final_report">Final report</option>
                                    </select>
                                  </div>
                                  <div className="space-y-2">
                                    <Label className="text-xs">Model</Label>
                                    <select
                                      value={step.modelId ?? ""}
                                      onChange={(event) =>
                                        updateWorkflowStep(workflow.id, step.id, { modelId: event.target.value || undefined })
                                      }
                                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                      disabled={Boolean(step.stepType === "deterministic_precheck")}
                                    >
                                      <option value="">No model</option>
                                      {[...new Set([...selectedModels, ...availableModels.map((model) => model.id)])].map((modelId) => (
                                        <option key={modelId} value={modelId}>
                                          {availableModels.find((model) => model.id === modelId)?.name ?? modelId}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="space-y-2">
                                    <Label className="text-xs">Prompt template</Label>
                                    <select
                                      value={step.promptTemplateId ?? ""}
                                      onChange={(event) =>
                                        updateWorkflowStep(workflow.id, step.id, {
                                          promptTemplateId: event.target.value || undefined,
                                        })
                                      }
                                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                      <option value="">No prompt</option>
                                      {promptTemplates.map((template) => (
                                        <option key={template.id} value={template.id}>
                                          {template.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="space-y-2">
                                    <Label className="text-xs">Input source</Label>
                                    <select
                                      value={step.inputSource}
                                      onChange={(event) =>
                                        updateWorkflowStep(workflow.id, step.id, {
                                          inputSource: event.target.value as WorkflowStep["inputSource"],
                                        })
                                      }
                                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                      <option value="case_data">Case data</option>
                                      <option value="previous_step">Previous step</option>
                                      <option value="reference_checks">Reference checks</option>
                                      <option value="combined">Combined</option>
                                    </select>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addWorkflowStep(workflow.id)}
                              disabled={Boolean(!hasMounted || workflow.steps.length >= 5)}
                            >
                              Add step
                            </Button>
                            <span className="text-xs text-muted-foreground">
                              Preview: {workflow.steps.map((step) => step.name || step.stepType).join(" -> ")}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Evaluation Configurations */}
              <Card className="scroll-mt-24">
                <CardHeader>
                  <CardTitle className="text-base">Evaluation Configurations</CardTitle>
                  <CardDescription>Compare workflow setups across selected benchmark cases</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {workflowTypeOptions.map((workflow) => (
                      <Button
                        key={workflow.value}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addEvaluationConfig(workflow.value)}
                        disabled={Boolean(!hasMounted || evaluationConfigs.length >= 5)}
                      >
                        {workflow.label}
                      </Button>
                    ))}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Add 1-5 configurations. If none are defined, batch evaluation uses the selected model fallback behavior.
                  </p>

                  <div className="space-y-3">
                    {evaluationConfigs.map((config) => {
                      const primaryModelId = config.modelIds[0] ?? ""
                      const verifierModelId = config.modelIds[1] ?? ""

                      return (
                        <div key={config.configId} className="rounded-lg border border-border p-4 space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-3">
                            <div className="space-y-2">
                              <Label htmlFor={`${config.configId}-label`} className="text-xs">Label</Label>
                              <Input
                                id={`${config.configId}-label`}
                                value={config.label}
                                onChange={(event) => updateEvaluationConfig(config.configId, { label: event.target.value })}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`${config.configId}-workflow`} className="text-xs">Workflow type</Label>
                              <select
                                id={`${config.configId}-workflow`}
                                value={config.workflowType}
                                onChange={(event) =>
                                  updateEvaluationConfig(config.configId, { workflowType: event.target.value as WorkflowType })
                                }
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              >
                                {workflowTypeOptions.map((workflow) => (
                                  <option key={workflow.value} value={workflow.value}>
                                    {workflow.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="flex items-end">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => removeEvaluationConfig(config.configId)}
                                disabled={Boolean(!hasMounted)}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label htmlFor={`${config.configId}-primary`} className="text-xs">Selected model</Label>
                              <select
                                id={`${config.configId}-primary`}
                                value={primaryModelId}
                                onChange={(event) =>
                                  updateEvaluationConfig(config.configId, {
                                    modelIds: [event.target.value, ...(config.workflowType === "verification" && verifierModelId ? [verifierModelId] : [])],
                                  })
                                }
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              >
                                {[...new Set([...selectedModels, ...availableModels.map((model) => model.id)])].map((modelId) => (
                                  <option key={modelId} value={modelId}>
                                    {availableModels.find((model) => model.id === modelId)?.name ?? modelId}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {config.workflowType === "verification" ? (
                              <div className="space-y-2">
                                <Label htmlFor={`${config.configId}-verifier`} className="text-xs">Verifier model</Label>
                                <select
                                  id={`${config.configId}-verifier`}
                                  value={verifierModelId}
                                  onChange={(event) =>
                                    updateEvaluationConfig(config.configId, {
                                      modelIds: event.target.value ? [primaryModelId, event.target.value] : [primaryModelId],
                                    })
                                  }
                                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                >
                                  <option value="">Use primary model</option>
                                  {[...new Set([...selectedModels, ...availableModels.map((model) => model.id)])].map((modelId) => (
                                    <option key={modelId} value={modelId}>
                                      {availableModels.find((model) => model.id === modelId)?.name ?? modelId}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : null}
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`${config.configId}-prompt-template`} className="text-xs">Prompt template</Label>
                            <select
                              id={`${config.configId}-prompt-template`}
                              value={config.promptTemplateId ?? getDefaultTemplateIdForWorkflow(config.workflowType)}
                              onChange={(event) => {
                                const template = promptTemplates.find((item) => item.id === event.target.value)
                                updateEvaluationConfig(config.configId, {
                                  promptTemplateId: event.target.value,
                                  promptTemplateText: template?.text,
                                })
                              }}
                              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            >
                              {promptTemplates.map((template) => (
                                <option key={template.id} value={template.id}>
                                  {template.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">{config.workflowType}</Badge>
                            <Badge variant="outline">
                              {promptTemplates.find((template) => template.id === config.promptTemplateId)?.name ?? "Default prompt"}
                            </Badge>
                            {config.workflowType === "deterministic_precheck_explanation" ? (
                              <Badge variant="secondary">Tool-assisted</Badge>
                            ) : null}
                            <Badge variant="outline">{config.promptStrategy}</Badge>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Benchmark Case Selection */}
              <Card id="benchmark-cases" className="scroll-mt-24">
                <CardHeader>
                  <CardTitle className="text-base">Benchmark Case Selection</CardTitle>
                  <CardDescription>Select cases from the benchmark library for batch evaluation</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="md:w-72">
                      <select
                        value={benchmarkCaseFilter}
                        onChange={(event) => setBenchmarkCaseFilter(event.target.value as BenchmarkCaseFilter)}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {benchmarkCaseFilters.map((filter) => (
                          <option key={filter.value} value={filter.value}>
                            {filter.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={selectAllVisibleBenchmarkCases}
                        disabled={Boolean(!hasMounted)}
                      >
                        Select all visible
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={clearBenchmarkCaseSelection}
                        disabled={Boolean(!hasMounted)}
                      >
                        Clear selection
                      </Button>
                      <Badge variant="secondary">{selectedBenchmarkCaseIds.length} selected</Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 max-h-[28rem] overflow-y-auto pr-1">
                    {filteredBenchmarkCases.map((benchmarkCase) => {
                      const isSelected = selectedBenchmarkCaseIds.includes(benchmarkCase.id)

                      return (
                        <button
                          key={benchmarkCase.id}
                          type="button"
                          onClick={() => toggleBenchmarkCase(benchmarkCase.id)}
                          disabled={Boolean(!hasMounted)}
                          className={`rounded-lg border-2 p-4 text-left transition-all ${
                            isSelected
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-muted-foreground/30"
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className={`text-sm font-medium ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
                                {benchmarkCase.title}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {formatBenchmarkSourceType(benchmarkCase.sourceType)} | Expected: {benchmarkCase.expectedReferenceLabel}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">{benchmarkCase.tags.join(", ")}</p>
                            </div>
                            {isSelected ? (
                              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                                Selected
                              </Badge>
                            ) : null}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {filteredBenchmarkCases.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No benchmark cases match this filter.</p>
                  ) : null}
                </CardContent>
              </Card>

              {/* Prompt Library */}
              <Card id="prompt-library" className="scroll-mt-24">
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <CardTitle className="text-base">Prompt Library</CardTitle>
                      <CardDescription>Inspect and edit local prompt templates used by future benchmark runs</CardDescription>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addPromptTemplate}
                      disabled={Boolean(!hasMounted)}
                    >
                      Add Prompt
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-warning-foreground">
                    Prompt changes affect future benchmark runs only.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Prompt Library stores reusable prompts. Workflow steps select prompts from this library.
                  </p>

                  <div className="space-y-3">
                    {promptTemplates.map((template) => {
                      const isEditing = editingPromptId === template.id

                      return (
                        <div key={template.id} className="rounded-lg border border-border p-4 space-y-3">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-medium text-foreground">{template.name}</p>
                                {template.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                                <Badge variant="outline">{template.expectedOutputSchema}</Badge>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>
                              <p className="mt-1 text-xs text-muted-foreground">Updated: {template.updatedAt}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => startEditingPrompt(template)}
                                disabled={Boolean(!hasMounted)}
                              >
                                View/Edit
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => duplicatePromptTemplate(template)}
                                disabled={Boolean(!hasMounted)}
                              >
                                Duplicate
                              </Button>
                              {template.isDefault ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => resetDefaultPromptTemplate(template.id)}
                                  disabled={Boolean(!hasMounted)}
                                >
                                  Reset default
                                </Button>
                              ) : null}
                              {!template.isDefault ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => deletePromptTemplate(template.id)}
                                  disabled={Boolean(!hasMounted)}
                                >
                                  Delete
                                </Button>
                              ) : null}
                            </div>
                          </div>

                          {isEditing ? (
                            <div className="space-y-3">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="space-y-2">
                                  <Label className="text-xs">Name</Label>
                                  <Input
                                    value={promptDraft.name}
                                    onChange={(event) =>
                                      setPromptDraft((current) => ({ ...current, name: event.target.value }))
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-xs">Expected output schema</Label>
                                  <select
                                    value={promptDraft.expectedOutputSchema}
                                    onChange={(event) =>
                                      setPromptDraft((current) => ({
                                        ...current,
                                        expectedOutputSchema: event.target.value as PromptTemplate["expectedOutputSchema"],
                                      }))
                                    }
                                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                  >
                                    <option value="pct_json">pct_json</option>
                                    <option value="free_text">free_text</option>
                                    <option value="verification_json">verification_json</option>
                                  </select>
                                </div>
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs">Description</Label>
                                <Input
                                  value={promptDraft.description}
                                  onChange={(event) =>
                                    setPromptDraft((current) => ({ ...current, description: event.target.value }))
                                  }
                                />
                              </div>
                              <Label className="text-xs">Prompt text</Label>
                              <textarea
                                value={promptDraft.text}
                                onChange={(event) =>
                                  setPromptDraft((current) => ({ ...current, text: event.target.value }))
                                }
                                className="min-h-48 w-full rounded-md border border-input bg-background p-3 text-sm"
                              />
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={savePromptTemplate}
                                  disabled={Boolean(!hasMounted || !editingPromptId)}
                                >
                                  Save Prompt
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setEditingPromptId(null)
                                    setPromptDraft(emptyPromptDraft)
                                  }}
                                  disabled={Boolean(!hasMounted)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              <Card className="scroll-mt-24">
                <CardHeader>
                  <CardTitle className="text-base">API Connections</CardTitle>
                  <CardDescription>Bring your own provider keys for this browser session</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    MVP security note: API keys are stored only in this browser session and are not persisted on the server.
                  </p>

                  {(["openrouter", "groq"] as ProviderId[]).map((provider) => {
                    const label = provider === "openrouter" ? "OpenRouter" : "Groq"
                    const connection = providerApiKeys[provider]
                    const isConnected = Boolean(hasMounted && connection)
                    const statusLabel = getProviderConnectionStatus({ hasMounted, isConnected })

                    return (
                      <div key={provider} className="rounded-lg border border-border p-4 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">{label}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <Badge variant={isConnected ? "secondary" : "outline"}>
                                {statusLabel}
                              </Badge>
                              {hasMounted && connection ? (
                                <span className="text-xs text-muted-foreground">{maskKey(connection.last4)}</span>
                              ) : null}
                            </div>
                          </div>
                          {hasMounted && connection ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => removeProviderKey(provider)}
                              disabled={Boolean(!hasMounted)}
                            >
                              Remove Key
                            </Button>
                          ) : null}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2">
                          <Input
                            type="password"
                            value={providerInputs[provider]}
                            onChange={(event) =>
                              setProviderInputs((current) => ({
                                ...current,
                                [provider]: event.target.value,
                              }))
                            }
                            placeholder={isConnected ? "Paste replacement key" : "Paste API key"}
                            autoComplete="off"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => saveProviderKey(provider)}
                            disabled={Boolean(!hasMounted || !providerInputs[provider].trim())}
                          >
                            {isConnected ? "Replace Key" : "Add Key"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => testProviderConnection(provider)}
                            disabled={Boolean(
                              !hasMounted ||
                                providerTesting === provider ||
                                (!isConnected && !providerInputs[provider].trim()),
                            )}
                          >
                            {providerTesting === provider ? "Testing..." : "Test Connection"}
                          </Button>
                        </div>

                        {providerTestStatus[provider] ? (
                          <p className="text-xs text-muted-foreground">{providerTestStatus[provider]}</p>
                        ) : null}
                      </div>
                    )
                  })}
                </CardContent>
              </Card>

              {/* Evaluation Criteria */}
              <Card className="scroll-mt-24">
                <CardHeader>
                  <CardTitle className="text-base">Evaluation Criteria</CardTitle>
                  <CardDescription>Select metrics to assess model performance</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {evaluationCriteria.map((criteria) => {
                      const isSelected = selectedCriteria.includes(criteria.id)
                      const Icon = criteria.icon
                      return (
                        <div 
                          key={criteria.id}
                          className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                            isSelected ? "border-primary/50 bg-primary/5" : "border-border"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-md flex items-center justify-center ${
                              isSelected ? "bg-primary/10" : "bg-muted"
                            }`}>
                              <Icon className={`w-4 h-4 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                            </div>
                            <div>
                              <p className="font-medium text-sm text-foreground">{criteria.name}</p>
                              <p className="text-xs text-muted-foreground">{criteria.description}</p>
                            </div>
                          </div>
                          <Switch 
                            checked={isSelected}
                            onCheckedChange={() => toggleCriteria(criteria.id)}
                          />
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Run Settings */}
              <Card id="run-settings" className="scroll-mt-24">
                <CardHeader>
                  <CardTitle className="text-base">Run Settings</CardTitle>
                  <CardDescription>Configure benchmark execution parameters</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <Label htmlFor="default-model-only-prompt" className="text-sm font-medium">
                      Default prompt template for model-only fallback
                    </Label>
                    <select
                      id="default-model-only-prompt"
                      value={defaultPromptTemplateId}
                      onChange={(event) => setDefaultPromptTemplateId(event.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {promptTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Ignored when workflows are enabled. Workflow prompts are selected per step.
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <Label htmlFor="cases" className="text-sm font-medium w-32">Number of cases</Label>
                    <Input 
                      id="cases"
                      type="number" 
                      value={numberOfCases}
                      onChange={(e) => setNumberOfCases(e.target.value)}
                      className="w-24"
                      min="1"
                      max="100"
                    />
                  </div>
                  
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <Label className="text-sm font-medium">Batch run</Label>
                      <p className="text-xs text-muted-foreground">Process all cases in sequence</p>
                    </div>
                    <Switch checked={batchRun} onCheckedChange={setBatchRun} />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-border p-3">
                    <div className="space-y-2">
                      <Label htmlFor="batch-delay-ms" className="text-sm font-medium">Delay between calls (ms)</Label>
                      <Input
                        id="batch-delay-ms"
                        type="number"
                        value={batchDelayMs}
                        onChange={(event) => setBatchDelayMs(event.target.value)}
                        min="0"
                        step="500"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="batch-max-retries" className="text-sm font-medium">Max retries</Label>
                      <Input
                        id="batch-max-retries"
                        type="number"
                        value={batchMaxRetries}
                        onChange={(event) => setBatchMaxRetries(event.target.value)}
                        min="0"
                        max="5"
                      />
                    </div>
                    <p className="md:col-span-2 text-xs text-muted-foreground">
                      Free/on-demand provider tiers may rate-limit larger runs. Use fewer cases/models or increase delay.
                    </p>
                  </div>
                  
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <Label className="text-sm font-medium">Store outputs</Label>
                      <p className="text-xs text-muted-foreground">Save all model responses to database</p>
                    </div>
                    <Switch checked={storeOutputs} onCheckedChange={setStoreOutputs} />
                  </div>
                  
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <Label className="text-sm font-medium">Generate summary report</Label>
                      <p className="text-xs text-muted-foreground">Create PDF report after completion</p>
                    </div>
                    <Switch checked={generateReport} onCheckedChange={setGenerateReport} />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Configuration Summary */}
          <Card id="configuration-summary" className="mt-6 max-w-7xl scroll-mt-24">
            <CardHeader>
              <CardTitle className="text-base">Configuration Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-6">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Provider</p>
                  <Badge variant="outline">{selectedProviderLabel}</Badge>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Selected Models</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedModels.length > 0 ? (
                      selectedModels.map(id => {
                        const model = availableModels.find(m => m.id === id)
                        const testResult = modelTestResults[id]
                        return (
                          <div key={id} className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">
                              {model?.name || id}
                            </Badge>
                            {testResult?.status === "available" ? (
                              <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                                Available
                              </Badge>
                            ) : null}
                            {testResult?.status === "failed" ? (
                              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                                Failed: {failureReasonLabels[testResult.failureReason ?? "unknown"]}
                              </Badge>
                            ) : null}
                          </div>
                        )
                      })
                    ) : (
                      <span className="text-sm text-muted-foreground">Predefined fallback configs</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Default Model-only Prompt</p>
                  <Badge variant="outline">
                    {promptTemplates.find((template) => template.id === defaultPromptTemplateId)?.name ??
                      "Baseline PCT prompt"}
                  </Badge>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedWorkflowIds.length > 0
                      ? "Workflow prompts are selected per step."
                      : "Model-only fallback uses selected models and this default prompt template."}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Evaluation Configurations</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedWorkflowIds.length > 0 ? (
                      <Badge variant="secondary">Workflow-based evaluation</Badge>
                    ) : evaluationConfigs.length > 0 ? (
                      evaluationConfigs.map((config) => (
                        <Badge key={config.configId} variant="outline">
                          {config.label}: {config.workflowType}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">Model-only fallback</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Evaluation Workflows</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedWorkflowIds.length > 0 ? (
                      evaluationWorkflows
                        .filter((workflow) => selectedWorkflowIds.includes(workflow.id))
                        .map((workflow) => (
                          <div key={workflow.id} className="space-y-1">
                            <Badge variant="outline">
                              {workflow.name}: {workflow.steps.length} steps
                            </Badge>
                            <p className="text-xs text-muted-foreground">
                              {workflow.steps
                                .map((step) => {
                                  const template = promptTemplates.find((item) => item.id === step.promptTemplateId)
                                  return `${step.name}: ${template?.name ?? "No prompt"}`
                                })
                                .join(" | ")}
                            </p>
                          </div>
                        ))
                    ) : (
                      <span className="text-sm text-muted-foreground">No workflows enabled</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Evaluation Criteria</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedCriteria.length > 0 ? (
                      selectedCriteria.map(id => {
                        const criteria = evaluationCriteria.find(c => c.id === id)
                        return criteria ? (
                          <Badge key={id} variant="secondary">{criteria.name}</Badge>
                        ) : null
                      })
                    ) : (
                      <span className="text-sm text-muted-foreground">No criteria selected</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Run Settings</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{selectedBenchmarkCaseIds.length || benchmarkCases.length} benchmark cases</Badge>
                    {batchRun && <Badge variant="outline">Batch</Badge>}
                    <Badge variant="outline">{summaryDelayMs} ms delay</Badge>
                    <Badge variant="outline">{summaryMaxRetries} retries</Badge>
                    {storeOutputs && <Badge variant="outline">Store outputs</Badge>}
                    {generateReport && <Badge variant="outline">Report</Badge>}
                  </div>
                </div>
              </div>
              
              <div className="flex gap-3 mt-6 pt-4 border-t border-border">
                <Button className="gap-2" onClick={runBenchmark} disabled={Boolean(!hasMounted || benchmarkRunning)}>
                  {benchmarkRunning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  {benchmarkRunning ? "Running Benchmark..." : "Run Benchmark"}
                </Button>
                <Button variant="outline" className="gap-2" disabled={Boolean(!hasMounted)}>
                  <Save className="w-4 h-4" />
                  Save Configuration
                </Button>
              </div>

              {benchmarkError ? (
                <p className="text-sm text-destructive mt-3">{benchmarkError}</p>
              ) : null}

              <p className="text-xs text-muted-foreground mt-3">
                MVP note: backend uses selected model IDs when 1-3 custom models are selected; otherwise it falls back to predefined free OpenRouter model/prompt configurations.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}
