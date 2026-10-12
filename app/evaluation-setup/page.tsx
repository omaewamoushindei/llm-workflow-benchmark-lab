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
import { Progress } from "@/components/ui/progress"
import { benchmarkCases, type BenchmarkCase } from "@/lib/benchmark-cases"
import { reconcileSelectedProviderModels } from "@/lib/llm-providers"
import {
  EVALUATION_CRITERIA_STORAGE_KEY,
  LATEST_EVALUATION_CRITERIA_STORAGE_KEY,
  getActiveScoringWeight,
  getReportOnlyCriteria,
  getScoringCriteria,
  parseEvaluationCriteria,
  resetEvaluationCriterion,
  type EvaluationCriterion,
  type EvaluationScoringMethod,
} from "@/lib/evaluation-criteria"
import { DEFAULT_EVALUATION_WORKFLOWS } from "@/lib/evaluation-workflows"
import { DEFAULT_PROMPT_TEMPLATES, getDefaultPromptTemplate } from "@/lib/prompt-templates"
import type { BenchmarkConfig, EvaluationConfig, EvaluationWorkflow, PromptTemplate, RunControls, WorkflowStep, WorkflowType } from "@/lib/types"
import {
  appendBenchmarkRunHistory,
  createWorkspaceExport,
  detectApiKeys,
  readBenchmarkRunHistory,
  stableStringify,
  toBenchmarkRunHistoryEntry,
  type WorkspaceConflictAction,
  writeBenchmarkRunHistory,
} from "@/lib/workspace-sharing"
import { 
  Play, 
  Save, 
  Bot,
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
  ok?: boolean
  success?: boolean
  providerId?: ProviderId
  modelId: string
  status: "available" | "failed"
  latencyMs?: number
  error?: string
  failureReason?:
    | "needs_credits"
    | "provider_error"
    | "rate_limited"
    | "no_endpoint"
    | "invalid_key"
    | "model_not_found"
    | "unknown"
}

type ModelTestResponse = {
  ok?: boolean
  success?: boolean
  providerId?: ProviderId
  results?: ModelTestResult[]
  error?: string
}

type PromptDraft = Pick<PromptTemplate, "name" | "description" | "text" | "expectedOutputSchema">
type CriterionDraft = Pick<EvaluationCriterion, "name" | "description" | "details" | "enabled" | "weight" | "scoringMethod">

type BenchmarkRunProgress = {
  isRunning: boolean
  startedAt: string | null
  elapsedSeconds: number
  estimatedTotalCalls: number
  estimatedTotalSteps: number
  completedCalls: number
  completedSteps: number
  currentStatus: string
  currentCaseLabel?: string
  currentConfigLabel?: string
  progressPercent: number
  estimatedRemainingSeconds?: number | null
  warning?: string | null
}

const INITIAL_BENCHMARK_PROGRESS: BenchmarkRunProgress = {
  isRunning: false,
  startedAt: null,
  elapsedSeconds: 0,
  estimatedTotalCalls: 0,
  estimatedTotalSteps: 0,
  completedCalls: 0,
  completedSteps: 0,
  currentStatus: "Not started",
  progressPercent: 0,
  estimatedRemainingSeconds: null,
  warning: null,
}

const AVERAGE_CALL_DURATION_ESTIMATE_MS = 5000

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
  { id: "providers", label: "Providers & Models" },
  { id: "prompts", label: "Prompt Library" },
  { id: "workflows", label: "Workflow Builder" },
  { id: "cases", label: "Cases" },
  { id: "run", label: "Run Settings" },
  { id: "summary", label: "Summary" },
] as const

type ActiveTab = "providers" | "prompts" | "workflows" | "cases" | "run" | "summary"

const failureReasonLabels: Record<NonNullable<ModelTestResult["failureReason"]>, string> = {
  needs_credits: "needs credits",
  provider_error: "provider error",
  rate_limited: "rate limited",
  no_endpoint: "no endpoint",
  invalid_key: "invalid key",
  model_not_found: "model not found",
  unknown: "unknown",
}

const scoringMethodLabels: Record<EvaluationScoringMethod, string> = {
  deterministic_reference_check: "Deterministic reference",
  json_field_alignment: "JSON field alignment",
  safety_rule_check: "Safety rule",
  explainability_rubric: "Explainability rubric",
  robustness_comparison: "Robustness comparison",
  report_only: "Report only",
}

type EvaluationSettings = {
  providerId: ProviderId
  selectedModelIds: string[]
  defaultPromptTemplateId: string
  evaluationConfigs?: EvaluationConfig[]
  selectedWorkflowIds?: string[]
  includeRawModelBaselines?: boolean
  includeStructuredPromptBaselines?: boolean
  includeEnabledWorkflows?: boolean
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
const CUSTOM_BENCHMARK_CASES_STORAGE_KEY = "customBenchmarkCases"
const DEFAULT_MODEL_ONLY_PROMPT_TEMPLATE_ID = "default-baseline-pct"
const WORKFLOW_LIBRARY_LIMIT = 25

type CategoryExportType = "promptTemplates" | "evaluationWorkflows" | "customBenchmarkCases"

type CategoryImportItem = PromptTemplate | EvaluationWorkflow | BenchmarkCase

type CategoryImportConflict = {
  id: string
  importedId: string
  importedName: string
  matchType: "id" | "name"
  summary: string
  defaultAction: WorkspaceConflictAction
}

type CategoryImportDraft = {
  type: CategoryExportType
  rawText: string
  items: CategoryImportItem[]
  conflicts: CategoryImportConflict[]
  apiKeysDetected: boolean
}

type CategoryExportPayload = {
  version: "1.0"
  type: CategoryExportType
  exportedAt: string
  appName: "LLM Workflow Benchmark Lab"
  data: Partial<Record<CategoryExportType, unknown[]>>
}

function mapLegacyPromptStrategyToTemplateId(value: unknown): string {
  if (value === "structured" || value === "json") return "default-structured-pct-json"
  if (value === "verification" || value === "multistep") return "default-verification-checklist"
  return DEFAULT_MODEL_ONLY_PROMPT_TEMPLATE_ID
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getCategoryItemId(item: CategoryImportItem): string {
  return item.id
}

function getCategoryItemName(item: CategoryImportItem): string {
  return "name" in item ? item.name : item.title
}

function getCategoryContent(item: CategoryImportItem, type: CategoryExportType): unknown {
  if (type === "customBenchmarkCases") return (item as BenchmarkCase).caseData
  return item
}

function categoryItemsEqual(a: CategoryImportItem, b: CategoryImportItem, type: CategoryExportType): boolean {
  return stableStringify(getCategoryContent(a, type)) === stableStringify(getCategoryContent(b, type))
}

function uniqueImportedId(base: string, existingIds: Set<string>): string {
  const safeBase = base.replace(/[^a-zA-Z0-9._-]/g, "-") || "imported-item"
  let candidate = `${safeBase}-imported`
  let index = 2
  while (existingIds.has(candidate)) {
    candidate = `${safeBase}-imported-${index}`
    index += 1
  }
  existingIds.add(candidate)
  return candidate
}

function sanitizeImportedItem<T extends CategoryImportItem>(
  item: T,
  type: CategoryExportType,
  existingIds: Set<string>,
  forceNewId = false,
): T {
  const next = { ...item } as T
  if (forceNewId || existingIds.has(getCategoryItemId(next))) {
    next.id = uniqueImportedId(getCategoryItemId(next) || getCategoryItemName(next), existingIds)
  } else {
    existingIds.add(next.id)
  }

  if (type === "evaluationWorkflows") {
    ;(next as EvaluationWorkflow).isDefault = false
  }

  return next
}

function isPromptTemplate(value: unknown): value is PromptTemplate {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.text === "string" &&
    (value.expectedOutputSchema === "pct_json" ||
      value.expectedOutputSchema === "free_text" ||
      value.expectedOutputSchema === "verification_json") &&
    typeof value.isDefault === "boolean" &&
    typeof value.updatedAt === "string"
  )
}

function isEvaluationWorkflow(value: unknown): value is EvaluationWorkflow {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.isDefault === "boolean" &&
    Array.isArray(value.steps)
  )
}

function isBenchmarkCase(value: unknown): value is BenchmarkCase {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    (value.sourceType === "synthetic_algorithm_case" || value.sourceType === "thermo_case_adapted") &&
    isRecord(value.caseData) &&
    typeof value.expectedReferenceLabel === "string" &&
    Array.isArray(value.tags)
  )
}

function validateCategoryItems(type: CategoryExportType, items: unknown[]): CategoryImportItem[] {
  if (type === "promptTemplates") return items.filter(isPromptTemplate)
  if (type === "evaluationWorkflows") return items.filter(isEvaluationWorkflow)
  return items.filter(isBenchmarkCase)
}

function buildCategoryExport(type: CategoryExportType, items: CategoryImportItem[]): CategoryExportPayload {
  return {
    version: "1.0",
    type,
    exportedAt: new Date().toISOString(),
    appName: "LLM Workflow Benchmark Lab",
    data: {
      [type]: items,
    },
  }
}

function parseCategoryImport(rawText: string, expectedType: CategoryExportType): CategoryImportDraft {
  const parsed = JSON.parse(rawText) as unknown
  if (!isRecord(parsed)) throw new Error("Imported JSON must be an object.")
  if (parsed.version !== "1.0") throw new Error("Unsupported import version.")
  if (parsed.type !== expectedType) throw new Error(`Expected ${expectedType} import file.`)
  if (!isRecord(parsed.data)) throw new Error("Import file is missing data.")
  const rawItems = parsed.data[expectedType]
  if (!Array.isArray(rawItems)) throw new Error(`Import file is missing ${expectedType}.`)

  return {
    type: expectedType,
    rawText,
    items: validateCategoryItems(expectedType, rawItems),
    conflicts: [],
    apiKeysDetected: detectApiKeys(parsed),
  }
}

function buildCategoryConflicts(
  type: CategoryExportType,
  localItems: CategoryImportItem[],
  importedItems: CategoryImportItem[],
): CategoryImportConflict[] {
  const conflicts: CategoryImportConflict[] = []
  const byId = new Map(localItems.map((item) => [getCategoryItemId(item), item]))
  const byName = new Map(localItems.map((item) => [getCategoryItemName(item).toLowerCase(), item]))

  for (const imported of importedItems) {
    const importedId = getCategoryItemId(imported)
    const importedName = getCategoryItemName(imported)
    const localById = byId.get(importedId)
    const localByName = byName.get(importedName.toLowerCase())

    if (localById && !categoryItemsEqual(localById, imported, type)) {
      conflicts.push({
        id: `${type}-${importedId}-id`,
        importedId,
        importedName,
        matchType: "id",
        summary: `Imported "${importedName}" has the same id as a local item but different content.`,
        defaultAction: "keep_mine",
      })
      continue
    }

    if (localByName && getCategoryItemId(localByName) !== importedId && !categoryItemsEqual(localByName, imported, type)) {
      conflicts.push({
        id: `${type}-${importedId || importedName}-name`,
        importedId,
        importedName,
        matchType: "name",
        summary: `Imported "${importedName}" has the same name/title as a local item but different content.`,
        defaultAction: "keep_mine",
      })
    }
  }

  return conflicts
}

function mergeCategoryItems<T extends CategoryImportItem>(args: {
  type: CategoryExportType
  localItems: T[]
  importedItems: T[]
  conflictActions: Record<string, WorkspaceConflictAction>
}): T[] {
  const existingIds = new Set(args.localItems.map((item) => item.id))
  const next = [...args.localItems]

  for (const imported of args.importedItems) {
    const importedId = getCategoryItemId(imported)
    const importedName = getCategoryItemName(imported)
    const localByIdIndex = next.findIndex((item) => getCategoryItemId(item) === importedId)
    const localByNameIndex = next.findIndex((item) => getCategoryItemName(item).toLowerCase() === importedName.toLowerCase())

    if (localByIdIndex >= 0) {
      if (categoryItemsEqual(next[localByIdIndex], imported, args.type)) continue
      const conflictId = `${args.type}-${importedId}-id`
      const action = args.conflictActions[conflictId] ?? "keep_mine"
      if (action === "accept_imported") next[localByIdIndex] = imported
      if (action === "keep_both") next.push(sanitizeImportedItem(imported, args.type, existingIds, true) as T)
      continue
    }

    if (localByNameIndex >= 0 && !categoryItemsEqual(next[localByNameIndex], imported, args.type)) {
      const conflictId = `${args.type}-${importedId || importedName}-name`
      const action = args.conflictActions[conflictId] ?? "keep_mine"
      if (action === "accept_imported") next[localByNameIndex] = sanitizeImportedItem(imported, args.type, existingIds, true) as T
      if (action === "keep_both") next.push(sanitizeImportedItem(imported, args.type, existingIds, true) as T)
      continue
    }

    next.push(sanitizeImportedItem(imported, args.type, existingIds) as T)
  }

  return next
}

function readRecordFromStorage(storage: Storage, key: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "null") as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
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
    const includeRawModelBaselines = maybe.includeRawModelBaselines !== false
    const includeStructuredPromptBaselines = maybe.includeStructuredPromptBaselines !== false
    const includeEnabledWorkflows = maybe.includeEnabledWorkflows !== false

    return {
      providerId,
      selectedModelIds,
      defaultPromptTemplateId,
      evaluationConfigs,
      selectedWorkflowIds,
      includeRawModelBaselines,
      includeStructuredPromptBaselines,
      includeEnabledWorkflows,
    }
  } catch {
    return null
  }
}

function parseCustomBenchmarkCases(raw: string | null): BenchmarkCase[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is BenchmarkCase => {
      if (!item || typeof item !== "object") return false
      const candidate = item as Partial<BenchmarkCase>
      return (
        typeof candidate.id === "string" &&
        typeof candidate.title === "string" &&
        (candidate.sourceType === "synthetic_algorithm_case" || candidate.sourceType === "thermo_case_adapted") &&
        !!candidate.caseData &&
        Array.isArray(candidate.tags)
      )
    })
  } catch {
    return []
  }
}

function toSafeConfigId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-")
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

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "Estimating..."
  const safeSeconds = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  if (minutes === 0) return `${remainingSeconds}s`
  return `${minutes}m ${remainingSeconds}s`
}

function countConfigCalls(config: BenchmarkConfig): number {
  if (config.configType === "workflow" && config.workflow) {
    return config.workflow.steps.filter((step) => step.stepType !== "deterministic_precheck" && Boolean(step.modelId)).length
  }
  return 1
}

function countConfigSteps(config: BenchmarkConfig): number {
  if (config.configType === "workflow" && config.workflow) return config.workflow.steps.length
  return 1
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
  const [freeOnly, setFreeOnly] = useState(false)
  const [textOnly, setTextOnly] = useState(false)
  const [structuredOnly, setStructuredOnly] = useState(false)
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all")
  const [sortOption, setSortOption] = useState<SortOption>("free-first")
  const [modelTestResults, setModelTestResults] = useState<Record<string, ModelTestResult>>({})
  const [modelsTesting, setModelsTesting] = useState(false)
  const [modelTestError, setModelTestError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>("providers")
  const [providerApiKeys, setProviderApiKeys] = useState<ProviderApiKeys>({})
  const [providerInputs, setProviderInputs] = useState<Record<ProviderId, string>>({
    openrouter: "",
    groq: "",
  })
  const [providerTesting, setProviderTesting] = useState<ProviderId | null>(null)
  const [providerTestStatus, setProviderTestStatus] = useState<Partial<Record<ProviderId, string>>>({})
  const [defaultPromptTemplateId, setDefaultPromptTemplateId] = useState(DEFAULT_MODEL_ONLY_PROMPT_TEMPLATE_ID)
  const [includeRawModelBaselines, setIncludeRawModelBaselines] = useState(true)
  const [includeStructuredPromptBaselines, setIncludeStructuredPromptBaselines] = useState(true)
  const [includeEnabledWorkflows, setIncludeEnabledWorkflows] = useState(true)
  const [criteriaLibrary, setCriteriaLibrary] = useState<EvaluationCriterion[]>(() => parseEvaluationCriteria(null))
  const [criteriaLoaded, setCriteriaLoaded] = useState(false)
  const [criteriaDisplayMode, setCriteriaDisplayMode] = useState<"compact" | "detailed">("compact")
  const [expandedCriterionIds, setExpandedCriterionIds] = useState<Record<string, boolean>>({})
  const [criteriaCopyStatus, setCriteriaCopyStatus] = useState<string | null>(null)
  const [editingCriterionId, setEditingCriterionId] = useState<string | null>(null)
  const [criterionDraft, setCriterionDraft] = useState<CriterionDraft | null>(null)
  const [numberOfCases, setNumberOfCases] = useState("10")
  const [batchDelayMs, setBatchDelayMs] = useState("2000")
  const [workflowStepDelayMs, setWorkflowStepDelayMs] = useState("2000")
  const [batchMaxRetries, setBatchMaxRetries] = useState("2")
  const [retryBackoffMode, setRetryBackoffMode] = useState<RunControls["retryBackoffMode"]>("provider_hint")
  const [maxOutputTokens, setMaxOutputTokens] = useState("600")
  const [continueOnError, setContinueOnError] = useState(true)
  const [stopAfterFailureRatePercent, setStopAfterFailureRatePercent] = useState("100")
  const [maxConfigsPerRun, setMaxConfigsPerRun] = useState("25")
  const [showRequestPayload, setShowRequestPayload] = useState(false)
  const [expandedWorkflowIds, setExpandedWorkflowIds] = useState<Record<string, boolean>>({})
  const [customBenchmarkCases, setCustomBenchmarkCases] = useState<BenchmarkCase[]>([])
  const [benchmarkCaseFilter, setBenchmarkCaseFilter] = useState<BenchmarkCaseFilter>("all")
  const [selectedBenchmarkCaseIds, setSelectedBenchmarkCaseIds] = useState<string[]>(
    benchmarkCases.map((benchmarkCase) => benchmarkCase.id),
  )
  const [benchmarkRunning, setBenchmarkRunning] = useState(false)
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null)
  const [benchmarkProgress, setBenchmarkProgress] = useState<BenchmarkRunProgress>(INITIAL_BENCHMARK_PROGRESS)
  const [benchmarkResultsReady, setBenchmarkResultsReady] = useState(false)
  const [activeCategoryImportType, setActiveCategoryImportType] = useState<CategoryExportType | null>(null)
  const [categoryImportText, setCategoryImportText] = useState("")
  const [categoryImportDraft, setCategoryImportDraft] = useState<CategoryImportDraft | null>(null)
  const [categoryImportActions, setCategoryImportActions] = useState<Record<string, WorkspaceConflictAction>>({})
  const [categoryImportMessage, setCategoryImportMessage] = useState<string | null>(null)

  useEffect(() => {
    setHasMounted(true)
  }, [])

  useEffect(() => {
    if (!hasMounted) return

    setPromptTemplates(parsePromptTemplates(window.localStorage.getItem(PROMPT_TEMPLATES_STORAGE_KEY)))
    setPromptTemplatesLoaded(true)
    setEvaluationWorkflows(parseEvaluationWorkflows(window.localStorage.getItem(EVALUATION_WORKFLOWS_STORAGE_KEY)))
    setWorkflowsLoaded(true)
    setCriteriaLibrary(parseEvaluationCriteria(window.localStorage.getItem(EVALUATION_CRITERIA_STORAGE_KEY)))
    setCriteriaLoaded(true)
    setCustomBenchmarkCases(parseCustomBenchmarkCases(window.localStorage.getItem(CUSTOM_BENCHMARK_CASES_STORAGE_KEY)))

    const existing = parseEvaluationSettings(window.localStorage.getItem(EVALUATION_SETTINGS_STORAGE_KEY))
    if (!existing) return

    const nextModels = existing.selectedModelIds.slice(0, 3)

    setSelectedProviderId(existing.providerId)
    if (nextModels.length > 0) setSelectedModels(nextModels)
    setDefaultPromptTemplateId(existing.defaultPromptTemplateId)
    setEvaluationConfigs(existing.evaluationConfigs ?? [])
    setSelectedWorkflowIds(existing.selectedWorkflowIds ?? DEFAULT_EVALUATION_WORKFLOWS.map((workflow) => workflow.id))
    setIncludeRawModelBaselines(existing.includeRawModelBaselines !== false)
    setIncludeStructuredPromptBaselines(existing.includeStructuredPromptBaselines !== false)
    setIncludeEnabledWorkflows(existing.includeEnabledWorkflows !== false)
  }, [hasMounted])

  useEffect(() => {
    if (!hasMounted || !criteriaLoaded) return

    try {
      window.localStorage.setItem(EVALUATION_CRITERIA_STORAGE_KEY, JSON.stringify(criteriaLibrary))
    } catch {
      // ignore localStorage write errors
    }
  }, [criteriaLibrary, criteriaLoaded, hasMounted])

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
      includeRawModelBaselines,
      includeStructuredPromptBaselines,
      includeEnabledWorkflows,
    }
    try {
      window.localStorage.setItem(EVALUATION_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // ignore localStorage write errors (e.g., storage disabled)
    }
  }, [
    defaultPromptTemplateId,
    evaluationConfigs,
    hasMounted,
    includeEnabledWorkflows,
    includeRawModelBaselines,
    includeStructuredPromptBaselines,
    selectedModels,
    selectedProviderId,
    selectedWorkflowIds,
  ])

  const refreshModels = async () => {
    if (!hasMounted) return

    setModelsLoading(true)
    setModelsError(null)

    try {
      const providerKey = providerApiKeys[selectedProviderId]?.key
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

      const nextModels = json.models ?? []
      setAvailableModels(nextModels)
      setSelectedModels((current) => reconcileSelectedProviderModels(current, nextModels))
      window.sessionStorage.setItem("latestProviderModelCatalog", JSON.stringify({
        providerId: selectedProviderId,
        models: nextModels,
        updatedAt: new Date().toISOString(),
      }))
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
    setFreeOnly(false)
  }

  const toggleCriterionEnabled = (criterionId: string) => {
    setCriteriaLibrary((current) =>
      current.map((criterion) =>
        criterion.id === criterionId
          ? { ...criterion, enabled: !criterion.enabled, updatedAt: new Date().toISOString() }
          : criterion,
      ),
    )
  }

  const toggleCriterionDetails = (criterionId: string) => {
    setExpandedCriterionIds((current) => ({
      ...current,
      [criterionId]: !current[criterionId],
    }))
  }

  const expandAllCriteria = () => {
    setExpandedCriterionIds(Object.fromEntries(criteriaLibrary.map((criterion) => [criterion.id, true])))
  }

  const collapseAllCriteria = () => {
    setExpandedCriterionIds({})
  }

  const copyEvaluationRubric = async () => {
    const summary = criteriaLibrary.map((criterion) => ({
      name: criterion.name,
      weight: criterion.weight,
      scoringMethod: criterion.scoringMethod,
      reportOnly: criterion.isReportOnly,
      sourceOfTruth: criterion.sourceOfTruth,
      requiredModelFields: criterion.requiredModelFields,
      referenceFieldsUsed: criterion.referenceFieldsUsed,
      subcriteria: criterion.subcriteria.map((item) => ({
        name: item.name,
        currentlyScored: item.currentlyScored,
        contribution: item.scoreContributionDescription,
      })),
      penalties: criterion.penalties.map((item) => ({
        name: item.name,
        severity: item.severity,
        currentlyScored: item.currentlyScored,
        penalty: item.penaltyDescription,
      })),
      caps: criterion.caps.map((item) => ({
        name: item.name,
        currentlyScored: item.currentlyScored,
        cap: item.capDescription,
      })),
      limitations: criterion.limitations,
    }))

    try {
      await navigator.clipboard.writeText(JSON.stringify(summary, null, 2))
      setCriteriaCopyStatus("Evaluation rubric copied.")
    } catch {
      setCriteriaCopyStatus("Could not copy rubric to clipboard.")
    }
  }

  const startEditingCriterion = (criterion: EvaluationCriterion) => {
    setEditingCriterionId(criterion.id)
    setCriterionDraft({
      name: criterion.name,
      description: criterion.description,
      details: criterion.details,
      enabled: criterion.enabled,
      weight: criterion.weight,
      scoringMethod: criterion.scoringMethod,
    })
  }

  const addCriterion = () => {
    const now = new Date().toISOString()
    const criterion: EvaluationCriterion = {
      id: `custom-criterion-${Date.now()}`,
      name: "New Criterion",
      description: "",
      shortDescription: "",
      detailedDescription: "Custom report-only criterion.",
      details: "",
      scoringMethod: "report_only",
      enabled: true,
      weight: 0,
      isDefault: false,
      isReportOnly: true,
      sourceOfTruth: ["User-defined report-only review"],
      requiredModelFields: [],
      referenceFieldsUsed: [],
      subcriteria: [],
      penalties: [],
      caps: [],
      configurableParameters: ["Custom criteria are report-only unless connected to a scoring method."],
      limitations: ["Not currently scored."],
      examplePass: "",
      exampleFail: "",
      updatedAt: now,
    }
    setCriteriaLibrary((current) => [...current, criterion])
    setEditingCriterionId(criterion.id)
    setCriterionDraft({
      name: criterion.name,
      description: criterion.description,
      details: criterion.details,
      enabled: criterion.enabled,
      weight: criterion.weight,
      scoringMethod: criterion.scoringMethod,
    })
  }

  const saveCriterionDraft = () => {
    if (!editingCriterionId || !criterionDraft) return

    setCriteriaLibrary((current) =>
      current.map((criterion) =>
        criterion.id === editingCriterionId
          ? {
              ...criterion,
              name: criterionDraft.name.trim() || "Untitled Criterion",
              description: criterionDraft.description,
              details: criterionDraft.details,
              enabled: criterionDraft.enabled,
              weight: Math.max(0, Math.round(Number(criterionDraft.weight) || 0)),
              scoringMethod: criterion.isDefault ? criterion.scoringMethod : criterionDraft.scoringMethod,
              updatedAt: new Date().toISOString(),
            }
          : criterion,
      ),
    )
    setEditingCriterionId(null)
    setCriterionDraft(null)
  }

  const deleteCriterion = (criterionId: string) => {
    setCriteriaLibrary((current) => current.filter((criterion) => criterion.id !== criterionId || criterion.isDefault))
    if (editingCriterionId === criterionId) {
      setEditingCriterionId(null)
      setCriterionDraft(null)
    }
  }

  const resetCriterion = (criterionId: string) => {
    const defaultCriterion = resetEvaluationCriterion(criterionId)
    if (!defaultCriterion) return
    setCriteriaLibrary((current) =>
      current.map((criterion) => (criterion.id === criterionId ? defaultCriterion : criterion)),
    )
    if (editingCriterionId === criterionId) {
      setEditingCriterionId(null)
      setCriterionDraft(null)
    }
  }

  const testSelectedModels = async () => {
    if (!hasMounted) return
    if (selectedModels.length === 0) return

    setModelsTesting(true)
    setModelTestError(null)

    try {
      const providerKey = providerApiKeys[selectedProviderId]?.key
      if (!providerKey) {
        throw new Error("Connect an API key for this provider first.")
      }

      const response = await fetch("/api/models/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId: selectedProviderId,
          modelIds: selectedModels,
          apiKey: providerKey,
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

  const allBenchmarkCases = useMemo(
    () => [...benchmarkCases, ...customBenchmarkCases],
    [customBenchmarkCases],
  )
  const filteredBenchmarkCases = useMemo(() => {
    return allBenchmarkCases.filter((benchmarkCase) =>
      benchmarkCaseMatchesFilter(benchmarkCase, benchmarkCaseFilter),
    )
  }, [allBenchmarkCases, benchmarkCaseFilter])

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

  const toggleWorkflowExpanded = (workflowId: string) => {
    setExpandedWorkflowIds((current) => ({
      ...current,
      [workflowId]: !current[workflowId],
    }))
  }

  const duplicateWorkflow = (workflow: EvaluationWorkflow) => {
    if (evaluationWorkflows.length >= WORKFLOW_LIBRARY_LIMIT) return
    const copy: EvaluationWorkflow = {
      ...workflow,
      id: `custom-${workflow.id}-${Date.now()}`,
      name: `${workflow.name} copy`,
      isDefault: false,
      steps: workflow.steps.map((step) => ({ ...step, id: `${step.id}-${Date.now()}` })),
    }
    setEvaluationWorkflows((current) => [...current, copy])
    setExpandedWorkflowIds((current) => ({ ...current, [copy.id]: true }))
  }

  const addWorkflow = () => {
    if (evaluationWorkflows.length >= WORKFLOW_LIBRARY_LIMIT) return
    const modelId = getDefaultModelId()
    const timestamp = Date.now()
    const workflow: EvaluationWorkflow = {
      id: `custom-workflow-${timestamp}`,
      name: "New Workflow",
      description: "",
      isDefault: false,
      steps: [
        {
          id: `custom-step-${timestamp}`,
          name: "Step 1",
          stepType: "llm_call",
          modelId: modelId ?? "",
          promptTemplateId: promptTemplates[0]?.id ?? "",
          inputSource: "case_data",
        },
      ],
    }
    setEvaluationWorkflows((current) => [...current, workflow])
    setSelectedWorkflowIds((current) => current.filter((id) => id !== workflow.id))
    setExpandedWorkflowIds((current) => ({ ...current, [workflow.id]: true }))
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

  const getPromptTemplateForRun = (templateId: string): PromptTemplate => {
    return (
      promptTemplates.find((template) => template.id === templateId) ??
      promptTemplates.find((template) => template.id === DEFAULT_MODEL_ONLY_PROMPT_TEMPLATE_ID) ??
      DEFAULT_PROMPT_TEMPLATES[0]
    )
  }

  const getStructuredPromptTemplateForRun = (): PromptTemplate => {
    return (
      promptTemplates.find((template) => template.id === "default-structured-pct-json") ??
      promptTemplates.find((template) => template.expectedOutputSchema === "pct_json") ??
      getPromptTemplateForRun(defaultPromptTemplateId)
    )
  }

  const readBoundedNumber = (value: string, fallback: number, max: number): number => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(Math.max(0, Math.round(parsed)), max)
  }

  const buildRunControls = (): RunControls => ({
    delayBetweenCallsMs: readBoundedNumber(batchDelayMs, 2000, 60000),
    delayBetweenWorkflowStepsMs: readBoundedNumber(workflowStepDelayMs, 2000, 60000),
    maxRetries: readBoundedNumber(batchMaxRetries, 2, 5),
    retryBackoffMode,
    maxOutputTokens: readBoundedNumber(maxOutputTokens, 600, 2000),
    continueOnError,
    stopAfterFailureRatePercent: readBoundedNumber(stopAfterFailureRatePercent, 100, 100),
    maxCasesPerRun: readBoundedNumber(numberOfCases, selectedBenchmarkCaseIds.length || allBenchmarkCases.length, 500),
    maxConfigsPerRun: readBoundedNumber(maxConfigsPerRun, 25, 100),
  })

  const buildBenchmarkConfigsForRun = (workflowsForRun: EvaluationWorkflow[]): BenchmarkConfig[] => {
    const rawTemplate = getPromptTemplateForRun(defaultPromptTemplateId)
    const structuredTemplate = getStructuredPromptTemplateForRun()
    const uniqueModelIds = Array.from(new Set(selectedModels.map((id) => id.trim()).filter(Boolean))).slice(0, 3)

    const modelConfigs = uniqueModelIds.flatMap((modelId): BenchmarkConfig[] => {
      const safeModelId = toSafeConfigId(modelId)
      const configs: BenchmarkConfig[] = []

      if (includeRawModelBaselines) {
        configs.push({
          configId: `model-raw-${safeModelId}`,
          label: `Raw baseline: ${modelId}`,
          configType: "model_only",
          providerId: selectedProviderId,
          modelId,
          promptTemplateId: rawTemplate.id,
          promptTemplateText: rawTemplate.text,
          stepCount: 1,
          toolAssisted: false,
        })
      }

      if (includeStructuredPromptBaselines) {
        configs.push({
          configId: `model-structured-${safeModelId}`,
          label: `Structured: ${modelId}`,
          configType: "model_only",
          providerId: selectedProviderId,
          modelId,
          promptTemplateId: structuredTemplate.id,
          promptTemplateText: structuredTemplate.text,
          stepCount: 1,
          toolAssisted: false,
        })
      }

      return configs
    })

    const workflowConfigs = includeEnabledWorkflows
      ? workflowsForRun.map((workflow): BenchmarkConfig => ({
          configId: `workflow-${toSafeConfigId(workflow.id)}`,
          label: `Workflow: ${workflow.name}`,
          configType: "workflow",
          providerId: selectedProviderId,
          workflowId: workflow.id,
          workflow,
          stepCount: workflow.steps.length,
          toolAssisted: workflow.steps.some((step) => step.stepType === "deterministic_precheck"),
        }))
      : []

    return [...modelConfigs, ...workflowConfigs]
  }

  const runBenchmark = async () => {
    if (!hasMounted || benchmarkRunning) return

    setBenchmarkRunning(true)
    setBenchmarkError(null)
    setBenchmarkResultsReady(false)

    try {
      const providerId = selectedProviderId
      const selectedIdsForRun = includeEnabledWorkflows ? selectedWorkflowIds : []
      const workflowsForRun = hydrateWorkflowsForRun(
        evaluationWorkflows.filter((workflow) => selectedIdsForRun.includes(workflow.id)),
      )
      const workflowValidationError = workflowsForRun.length > 0 ? validateEnabledWorkflows(workflowsForRun) : null
      if (workflowValidationError) {
        throw new Error(workflowValidationError)
      }
      const configsForRun = hydrateConfigsWithPromptTemplates(evaluationConfigs)
      const benchmarkConfigs = buildBenchmarkConfigsForRun(workflowsForRun)
      if (benchmarkConfigs.length === 0) {
        throw new Error("Select at least one benchmark configuration: raw baselines, structured baselines, or workflows.")
      }
      const workflowPromptTemplateIds = new Set(
        workflowsForRun.flatMap((workflow) =>
          workflow.steps
            .map((step) => step.promptTemplateId)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      )
      benchmarkConfigs.forEach((config) => {
        if (config.promptTemplateId) workflowPromptTemplateIds.add(config.promptTemplateId)
      })
      const promptTemplatesForRun = promptTemplates.filter((template) => workflowPromptTemplateIds.has(template.id))
      const defaultPromptTemplate =
        getPromptTemplateForRun(defaultPromptTemplateId)
      const apiKey = providerApiKeys[providerId]?.key
      const runControls = buildRunControls()
      if (benchmarkConfigs.length > runControls.maxConfigsPerRun) {
        throw new Error("Too many benchmark configurations selected. Disable some workflows/configs or increase maxConfigsPerRun.")
      }
      const configsForProgress = benchmarkConfigs.slice(0, runControls.maxConfigsPerRun)
      const caseCountForProgress = Math.min(
        selectedBenchmarkCaseIds.length || allBenchmarkCases.length,
        runControls.maxCasesPerRun,
      )
      const estimatedTotalCalls =
        configsForProgress.reduce((sum, config) => sum + countConfigCalls(config), 0) * caseCountForProgress
      const estimatedTotalSteps =
        configsForProgress.reduce((sum, config) => sum + countConfigSteps(config), 0) * caseCountForProgress
      const firstSelectedCase =
        allBenchmarkCases.find((benchmarkCase) => selectedBenchmarkCaseIds.includes(benchmarkCase.id)) ?? allBenchmarkCases[0]

      setBenchmarkProgress({
        isRunning: true,
        startedAt: new Date().toISOString(),
        elapsedSeconds: 0,
        estimatedTotalCalls,
        estimatedTotalSteps,
        completedCalls: 0,
        completedSteps: 0,
        currentStatus: "Preparing benchmark request...",
        currentCaseLabel: firstSelectedCase?.title,
        currentConfigLabel: configsForProgress[0]?.label,
        progressPercent: 1,
        estimatedRemainingSeconds: null,
        warning: null,
      })

      setBenchmarkProgress((current) => ({
        ...current,
        currentStatus: "Sending benchmark request...",
        progressPercent: Math.max(current.progressPercent, 3),
      }))

      const response = await fetch("/api/batch-evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          apiKey,
          selectedModelIds: selectedModels,
          evaluationConfigs: configsForRun,
          evaluationWorkflows: workflowsForRun,
          benchmarkConfigs,
          promptTemplates: promptTemplatesForRun,
          criteriaSettings: criteriaLibrary,
          defaultPromptTemplateId: defaultPromptTemplate.id,
          defaultPromptTemplateText: defaultPromptTemplate.text,
          caseIds: selectedBenchmarkCaseIds,
          delayMs: runControls.delayBetweenCallsMs,
          maxRetries: runControls.maxRetries,
          runControls,
        }),
      })

      setBenchmarkProgress((current) => ({
        ...current,
        currentStatus: "Waiting for provider responses...",
        progressPercent: Math.max(current.progressPercent, 5),
      }))

      const json = await response.json()

      if (!response.ok) {
        throw new Error(json?.error || `Benchmark failed with status ${response.status}`)
      }

      setBenchmarkProgress((current) => ({
        ...current,
        currentStatus: "Processing results...",
        progressPercent: Math.max(current.progressPercent, 96),
      }))

      window.sessionStorage.setItem("latestBatchEvaluationResponse", JSON.stringify(json))
      // TODO: include criteria settings in persisted backend batch metadata when server-side run storage is added.
      window.sessionStorage.setItem(LATEST_EVALUATION_CRITERIA_STORAGE_KEY, JSON.stringify(criteriaLibrary))
      const runHistoryEntry = toBenchmarkRunHistoryEntry({
        batch: json,
        criteriaSnapshot: criteriaLibrary,
        promptTemplatesSnapshot: promptTemplatesForRun,
        workflowsSnapshot: workflowsForRun,
      })
      writeBenchmarkRunHistory(
        window.localStorage,
        appendBenchmarkRunHistory(readBenchmarkRunHistory(window.localStorage), runHistoryEntry),
      )
      const completedCalls = typeof json?.estimatedCalls === "number" ? json.estimatedCalls : estimatedTotalCalls
      const completedSteps = estimatedTotalSteps
      setBenchmarkProgress((current) => ({
        ...current,
        isRunning: false,
        estimatedTotalCalls: completedCalls,
        estimatedTotalSteps: completedSteps,
        completedCalls,
        completedSteps,
        currentStatus: "Benchmark completed",
        progressPercent: 100,
        estimatedRemainingSeconds: 0,
        warning: null,
      }))
      setBenchmarkResultsReady(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown benchmark error"
      setBenchmarkError(message)
      setBenchmarkProgress((current) => ({
        ...current,
        isRunning: false,
        currentStatus: "Benchmark failed",
        warning: message,
        estimatedRemainingSeconds: null,
      }))
    } finally {
      setBenchmarkRunning(false)
    }
  }

  const resetBenchmarkProgress = () => {
    setBenchmarkProgress(INITIAL_BENCHMARK_PROGRESS)
    setBenchmarkError(null)
    setBenchmarkResultsReady(false)
  }

  const downloadJson = (filename: string, value: unknown) => {
    if (!hasMounted) return
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const getLocalCategoryItems = (type: CategoryExportType): CategoryImportItem[] => {
    if (type === "promptTemplates") return promptTemplates
    if (type === "evaluationWorkflows") return evaluationWorkflows
    return customBenchmarkCases
  }

  const exportCategory = (type: CategoryExportType) => {
    const filename =
      type === "promptTemplates"
        ? "pct-prompt-templates.json"
        : type === "evaluationWorkflows"
          ? "pct-evaluation-workflows.json"
          : "pct-custom-benchmark-cases.json"
    downloadJson(filename, buildCategoryExport(type, getLocalCategoryItems(type)))
  }

  const openCategoryImport = (type: CategoryExportType) => {
    setActiveCategoryImportType(type)
    setCategoryImportText("")
    setCategoryImportDraft(null)
    setCategoryImportActions({})
    setCategoryImportMessage(null)
  }

  const previewCategoryImport = (type: CategoryExportType, rawText: string) => {
    setCategoryImportText(rawText)
    setCategoryImportMessage(null)
    try {
      const draft = parseCategoryImport(rawText, type)
      const conflicts = buildCategoryConflicts(type, getLocalCategoryItems(type), draft.items)
      setCategoryImportDraft({ ...draft, conflicts })
      setCategoryImportActions(Object.fromEntries(conflicts.map((conflict) => [conflict.id, conflict.defaultAction])))
      if (draft.items.length === 0) {
        setCategoryImportMessage("No valid items found in this import file.")
      }
    } catch (error) {
      setCategoryImportDraft(null)
      setCategoryImportActions({})
      setCategoryImportMessage(error instanceof Error ? error.message : "Could not parse import JSON.")
    }
  }

  const handleCategoryImportFile = async (type: CategoryExportType, file: File | undefined) => {
    if (!file) return
    previewCategoryImport(type, await file.text())
  }

  const applyCategoryImport = () => {
    if (!categoryImportDraft) return
    const { type, items } = categoryImportDraft

    if (type === "promptTemplates") {
      setPromptTemplates((current) =>
        mergeCategoryItems({
          type,
          localItems: current,
          importedItems: items.filter(isPromptTemplate),
          conflictActions: categoryImportActions,
        }),
      )
    }

    if (type === "evaluationWorkflows") {
      setEvaluationWorkflows((current) =>
        mergeCategoryItems({
          type,
          localItems: current,
          importedItems: items.filter(isEvaluationWorkflow),
          conflictActions: categoryImportActions,
        }),
      )
    }

    if (type === "customBenchmarkCases") {
      const nextCases = mergeCategoryItems({
        type,
        localItems: customBenchmarkCases,
        importedItems: items.filter(isBenchmarkCase),
        conflictActions: categoryImportActions,
      })
      setCustomBenchmarkCases(nextCases)
      try {
        window.localStorage.setItem(CUSTOM_BENCHMARK_CASES_STORAGE_KEY, JSON.stringify(nextCases))
      } catch {
        // ignore localStorage write errors
      }
    }

    setCategoryImportMessage(`Imported ${items.length} ${type} item${items.length === 1 ? "" : "s"}.`)
    setCategoryImportDraft(null)
    setCategoryImportText("")
    setCategoryImportActions({})
  }

  const exportFullWorkspace = () => {
    if (!hasMounted) return
    const evaluationSettings = readRecordFromStorage(window.localStorage, EVALUATION_SETTINGS_STORAGE_KEY)
    const latestBatchEvaluationResponse = readRecordFromStorage(window.sessionStorage, "latestBatchEvaluationResponse")
    const latestSingleCaseExecutionResponse = readRecordFromStorage(
      window.sessionStorage,
      "latestSingleCaseExecutionResponse",
    )

    downloadJson(
      "pct-workspace-export.json",
      createWorkspaceExport({
        customBenchmarkCases,
        evaluationWorkflows,
        promptTemplates,
        evaluationCriteria: criteriaLibrary,
        evaluationSettings,
        benchmarkRunHistory: readBenchmarkRunHistory(window.localStorage),
        latestBatchEvaluationResponse,
        latestSingleCaseExecutionResponse,
      }),
    )
  }

  const renderCategoryImportPanel = (type: CategoryExportType) => {
    if (activeCategoryImportType !== type) return null
    const title =
      type === "promptTemplates"
        ? "Import Prompts"
        : type === "evaluationWorkflows"
          ? "Import Workflows"
          : "Import Custom Cases"

    return (
      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">Paste JSON or upload an exported category file.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setActiveCategoryImportType(null)
              setCategoryImportDraft(null)
              setCategoryImportText("")
              setCategoryImportMessage(null)
            }}
            disabled={Boolean(!hasMounted)}
          >
            Close
          </Button>
        </div>
        <Input
          type="file"
          accept="application/json,.json"
          onChange={(event) => void handleCategoryImportFile(type, event.target.files?.[0])}
          disabled={Boolean(!hasMounted)}
        />
        <textarea
          value={categoryImportText}
          onChange={(event) => previewCategoryImport(type, event.target.value)}
          placeholder="Paste exported JSON here"
          className="min-h-36 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          disabled={Boolean(!hasMounted)}
        />
        {categoryImportDraft?.type === type ? (
          <div className="space-y-3">
            {categoryImportDraft.apiKeysDetected ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                API-key-like fields were detected and ignored.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {categoryImportDraft.items.length} valid item{categoryImportDraft.items.length === 1 ? "" : "s"} found.
            </p>
            {categoryImportDraft.conflicts.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">Conflict review</p>
                {categoryImportDraft.conflicts.map((conflict) => (
                  <div key={conflict.id} className="rounded-md border border-border p-3">
                    <p className="text-xs text-muted-foreground">{conflict.summary}</p>
                    <select
                      value={categoryImportActions[conflict.id] ?? conflict.defaultAction}
                      onChange={(event) =>
                        setCategoryImportActions((current) => ({
                          ...current,
                          [conflict.id]: event.target.value as WorkspaceConflictAction,
                        }))
                      }
                      className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm md:w-56"
                    >
                      <option value="keep_mine">Keep mine</option>
                      <option value="accept_imported">Accept imported</option>
                      <option value="keep_both">Keep both</option>
                      <option value="skip_imported">Skip imported</option>
                    </select>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No conflicts detected.</p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={applyCategoryImport}
              disabled={Boolean(!hasMounted || categoryImportDraft.items.length === 0)}
            >
              Confirm Import
            </Button>
          </div>
        ) : null}
        {categoryImportMessage ? <p className="text-xs text-muted-foreground">{categoryImportMessage}</p> : null}
      </div>
    )
  }

  const visibleModels = filteredModels.slice(0, visibleModelLimit)
  const defaultBenchmarkCaseIds = new Set(benchmarkCases.map((benchmarkCase) => benchmarkCase.id))
  const filteredDefaultBenchmarkCases = filteredBenchmarkCases.filter((benchmarkCase) =>
    defaultBenchmarkCaseIds.has(benchmarkCase.id),
  )
  const filteredCustomBenchmarkCases = filteredBenchmarkCases.filter(
    (benchmarkCase) => !defaultBenchmarkCaseIds.has(benchmarkCase.id),
  )
  const renderBenchmarkCaseButton = (benchmarkCase: BenchmarkCase) => {
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
  }
  const hasFailedSelectedModels = selectedModels.some(
    (modelId) => modelTestResults[modelId]?.status === "failed",
  )
  const selectedProviderLabel = selectedProviderId === "openrouter" ? "OpenRouter" : "Groq"
  const summaryRunControls = buildRunControls()
  const summaryDelayMs = summaryRunControls.delayBetweenCallsMs
  const summaryMaxRetries = summaryRunControls.maxRetries
  const enabledSummaryWorkflows = evaluationWorkflows.filter((workflow) => selectedWorkflowIds.includes(workflow.id))
  const modelOnlyConfigCount =
    selectedModels.length *
    Number(includeRawModelBaselines) +
    selectedModels.length *
    Number(includeStructuredPromptBaselines)
  const workflowConfigCount = includeEnabledWorkflows ? enabledSummaryWorkflows.length : 0
  const totalBenchmarkConfigCount = modelOnlyConfigCount + workflowConfigCount
  const summaryWorkflowsForRun = hydrateWorkflowsForRun(includeEnabledWorkflows ? enabledSummaryWorkflows : [])
  const allSummaryBenchmarkConfigs = buildBenchmarkConfigsForRun(summaryWorkflowsForRun)
  const summaryBenchmarkConfigs = allSummaryBenchmarkConfigs.slice(0, summaryRunControls.maxConfigsPerRun)
  const tooManyBenchmarkConfigs = allSummaryBenchmarkConfigs.length > summaryRunControls.maxConfigsPerRun
  const runValidationMessage = tooManyBenchmarkConfigs
    ? "Too many benchmark configurations selected. Disable some workflows/configs or increase maxConfigsPerRun."
    : null
  const summaryCaseCount = Math.min(
    selectedBenchmarkCaseIds.length || allBenchmarkCases.length,
    summaryRunControls.maxCasesPerRun,
  )
  const summaryEstimatedCalls =
    summaryBenchmarkConfigs.reduce((sum, config) => {
      return sum + countConfigCalls(config)
    }, 0) * summaryCaseCount
  const summaryEstimatedSteps =
    summaryBenchmarkConfigs.reduce((sum, config) => sum + countConfigSteps(config), 0) * summaryCaseCount
  const activeScoringCriteria = getScoringCriteria(criteriaLibrary)
  const reportOnlyCriteria = getReportOnlyCriteria(criteriaLibrary)
  const activeScoringWeight = getActiveScoringWeight(criteriaLibrary)
  const summaryRiskLevel =
    summaryEstimatedCalls > 80 || summaryRunControls.delayBetweenCallsMs < 1000
      ? "high"
      : summaryEstimatedCalls > 30 || summaryRunControls.delayBetweenCallsMs < 2000
        ? "medium"
        : "low"
  const summaryRequestPayload = {
    providerId: selectedProviderId,
    selectedModelIds: selectedModels,
    benchmarkConfigs: summaryBenchmarkConfigs.map(({ promptTemplateText: _promptTemplateText, workflow, ...config }) => ({
      ...config,
      workflow: workflow
        ? {
            ...workflow,
            steps: workflow.steps.map(({ promptTemplateText: _stepPromptTemplateText, ...step }) => step),
          }
        : undefined,
      hasPromptTemplateText: true,
    })),
    promptTemplates: "omitted from preview",
    criteriaSettings: criteriaLibrary,
    caseIds: selectedBenchmarkCaseIds,
    runControls: summaryRunControls,
  }
  const showBenchmarkProgress = benchmarkProgress.startedAt !== null
  const tabContentClassName =
    activeTab === "providers"
      ? "grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-7xl scroll-mt-24"
      : activeTab === "workflows" || activeTab === "summary"
        ? "max-w-5xl mx-auto space-y-6 scroll-mt-24"
        : "max-w-3xl mx-auto space-y-6 scroll-mt-24"

  const renderRubricList = (items: string[]) => (
    <ul className="mt-2 list-disc space-y-1 pl-5">
      {items.length > 0 ? items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>) : <li>None specified.</li>}
    </ul>
  )

  const renderScoredBadge = (currentlyScored: boolean) => (
    <Badge variant={currentlyScored ? "secondary" : "outline"}>
      {currentlyScored ? "Currently scored" : "Not currently scored"}
    </Badge>
  )

  useEffect(() => {
    if (!benchmarkProgress.isRunning || !benchmarkProgress.startedAt) return

    const timer = window.setInterval(() => {
      setBenchmarkProgress((current) => {
        if (!current.isRunning || !current.startedAt) return current

        const elapsedMs = Date.now() - new Date(current.startedAt).getTime()
        const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
        const estimatedDurationMs =
          current.estimatedTotalCalls * AVERAGE_CALL_DURATION_ESTIMATE_MS +
          current.estimatedTotalSteps * summaryRunControls.delayBetweenWorkflowStepsMs +
          current.estimatedTotalCalls * summaryRunControls.delayBetweenCallsMs
        const safeEstimatedDurationMs = Math.max(estimatedDurationMs, AVERAGE_CALL_DURATION_ESTIMATE_MS)
        const progressPercent = Math.min(95, Math.max(5, Math.round((elapsedMs / safeEstimatedDurationMs) * 100)))
        const estimatedRemainingSeconds = Math.max(0, Math.ceil((safeEstimatedDurationMs - elapsedMs) / 1000))
        const warning =
          elapsedMs > safeEstimatedDurationMs * 2
            ? "Long run detected. You can wait, reduce cases/configs, or increase delay settings for the next run."
            : elapsedMs > safeEstimatedDurationMs
              ? "This run is taking longer than estimated. Provider rate limits or retries may be active."
              : null

        return {
          ...current,
          elapsedSeconds,
          progressPercent,
          estimatedRemainingSeconds,
          currentStatus: progressPercent > 10 ? "Running provider calls..." : current.currentStatus,
          warning,
        }
      })
    }, 1000)

    // Future improvement: stream real progress events from /api/batch-evaluate using SSE or WebSockets.
    return () => window.clearInterval(timer)
  }, [
    benchmarkProgress.isRunning,
    benchmarkProgress.startedAt,
    summaryRunControls.delayBetweenCallsMs,
    summaryRunControls.delayBetweenWorkflowStepsMs,
  ])

  if (!hasMounted) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar activePage="Evaluation Setup" />

        <div className="flex-1 flex flex-col overflow-hidden">
          <Header
            title="Evaluation Setup"
            description="Advanced evaluation workspace for configuring providers, prompts, workflows, benchmark cases, scoring criteria, and run controls."
          />

          <main className="flex-1 overflow-y-auto p-6">
            <div className="max-w-7xl space-y-6">
              {activeTab === "providers" && (
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
              )}
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
          description="Advanced evaluation workspace for configuring providers, prompts, workflows, benchmark cases, scoring criteria, and run controls."
        />
        
        <main className="flex-1 overflow-y-auto p-6">
          <div className="sticky top-0 z-20 -mx-6 mb-6 border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
            <nav className="flex max-w-7xl gap-2 overflow-x-auto" aria-label="Evaluation setup tabs">
              {setupSections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveTab(section.id)}
                  className={`shrink-0 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    activeTab === section.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {section.label}
                </button>
              ))}
            </nav>
          </div>

          {activeTab !== "summary" && (
          <div className={tabContentClassName}>
            {/* Left Column */}
            <div className="space-y-6">
              {/* Model Selection */}
              {activeTab === "providers" && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Model Selection</CardTitle>
                      <CardDescription>Choose provider models used by benchmark configurations and workflow steps</CardDescription>
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
                        No custom models selected. Model-only benchmark configurations require at least one selected model.
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
                      {selectedProviderId === "openrouter"
                        ? "Paid models may fail if your OpenRouter account has no credits. Use Free Only or add credits."
                        : "Groq free/on-demand tiers may rate-limit large benchmark runs. Use fewer cases/configs or increase run delays."}
                    </p>
                    {selectedProviderId === "openrouter" ? (
                      <p className="text-xs text-muted-foreground mt-1">
                        Free models may still fail because of provider availability or rate limits. Use Test Selected Models before running evaluation.
                      </p>
                    ) : null}
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
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                        <Label htmlFor="freeOnly" className="text-sm">
                          Free models only
                          {selectedProviderId === "groq" ? (
                            <span className="mt-1 block text-xs font-normal text-muted-foreground">OpenRouter only</span>
                          ) : null}
                        </Label>
                        <Switch
                          id="freeOnly"
                          checked={freeOnly}
                          onCheckedChange={setFreeOnly}
                          disabled={selectedProviderId === "groq"}
                          aria-describedby={selectedProviderId === "groq" ? "groqPricingNote" : undefined}
                        />
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
                      {selectedProviderId === "groq" ? (
                        <span id="groqPricingNote">
                          Groq's models API does not include per-model pricing, so a reliable free-only filter is unavailable.
                          The catalog still shows the models currently returned for your Groq key; plan limits apply.
                        </span>
                      ) : (
                        "Provider model metadata varies. If no models appear, disable filters or refresh models."
                      )}
                    </p>

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
                      No models loaded yet. Refresh models to fetch the provider catalog.
                    </p>
                  ) : null}
                  {!modelsLoading && availableModels.length > 0 && filteredModels.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {modelSearch.trim()
                        ? "No models match the current search and filters."
                        : "No models match the current filters."}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
              )}

              {/* Workflow Builder */}
              {activeTab === "workflows" && (
              <Card id="workflow-builder" className="scroll-mt-24">
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <CardTitle className="text-base">Workflow Builder</CardTitle>
                      <CardDescription>Create reusable linear workflows. Run limits are enforced separately in Summary.</CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => exportCategory("evaluationWorkflows")}
                        disabled={Boolean(!hasMounted)}
                      >
                        Export Workflows
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openCategoryImport("evaluationWorkflows")}
                        disabled={Boolean(!hasMounted)}
                      >
                        Import Workflows
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {renderCategoryImportPanel("evaluationWorkflows")}
                  <p className="text-xs text-muted-foreground">
                    Each enabled workflow becomes one benchmark configuration when running a benchmark.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addWorkflow}
                      disabled={Boolean(!hasMounted || evaluationWorkflows.length >= WORKFLOW_LIBRARY_LIMIT)}
                    >
                      Add Workflow
                    </Button>
                    <Badge variant="secondary">{selectedWorkflowIds.length} enabled</Badge>
                  </div>
                  {evaluationWorkflows.length >= WORKFLOW_LIBRARY_LIMIT ? (
                    <p className="text-xs text-destructive">
                      Workflow library limit reached ({WORKFLOW_LIBRARY_LIMIT}). Delete a custom workflow before adding more.
                    </p>
                  ) : null}

                  <div className="space-y-3">
                    {evaluationWorkflows.map((workflow) => {
                      const isEnabled = selectedWorkflowIds.includes(workflow.id)
                      const isExpanded = expandedWorkflowIds[workflow.id] === true
                      const workflowValidation = validateEnabledWorkflows([workflow])
                      const isToolAssisted = workflow.steps.some((step) => step.stepType === "deterministic_precheck")

                      return (
                        <div key={workflow.id} className="rounded-lg border border-border p-4 space-y-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="space-y-2 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Switch checked={isEnabled} onCheckedChange={() => toggleWorkflowSelection(workflow.id)} />
                                <p className="text-sm font-medium text-foreground">{workflow.name}</p>
                                <Badge variant={isEnabled ? "secondary" : "outline"}>{isEnabled ? "Enabled" : "Disabled"}</Badge>
                                {workflow.isDefault ? <Badge variant="secondary">Default</Badge> : <Badge variant="outline">Custom</Badge>}
                                <Badge variant="outline">{workflow.steps.length} steps</Badge>
                                {isToolAssisted ? <Badge variant="secondary">Tool-assisted</Badge> : null}
                                <Badge
                                  variant="outline"
                                  className={workflowValidation ? "border-destructive/40 text-destructive" : "border-success/30 text-success"}
                                >
                                  {workflowValidation ? "Needs attention" : "Valid"}
                                </Badge>
                              </div>
                              {workflow.description ? (
                                <p className="text-xs text-muted-foreground">{workflow.description}</p>
                              ) : null}
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => duplicateWorkflow(workflow)}
                              disabled={Boolean(!hasMounted || evaluationWorkflows.length >= WORKFLOW_LIBRARY_LIMIT)}
                            >
                              Duplicate
                            </Button>
                            {!workflow.isDefault ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => deleteWorkflow(workflow.id)}
                                disabled={Boolean(!hasMounted)}
                              >
                                Delete
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => toggleWorkflowExpanded(workflow.id)}
                              disabled={Boolean(!hasMounted)}
                            >
                              {isExpanded ? "Collapse" : "Expand/Edit"}
                            </Button>
                          </div>

                          {isExpanded ? (
                            <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label className="text-xs">Workflow name</Label>
                              <Input
                                value={workflow.name}
                                onChange={(event) => updateWorkflow(workflow.id, { name: event.target.value })}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs">Description</Label>
                              <Input
                                value={workflow.description}
                                onChange={(event) => updateWorkflow(workflow.id, { description: event.target.value })}
                              />
                            </div>
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
                            </>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
              )}

              {/* Evaluation Configurations */}
              {false ? (
              <Card className="hidden">
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
              ) : null}

              {/* Benchmark Case Selection */}
              {activeTab === "cases" && (
              <Card id="benchmark-cases" className="scroll-mt-24">
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <CardTitle className="text-base">Benchmark Case Selection</CardTitle>
                      <CardDescription>Select cases from the benchmark library for batch evaluation</CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => router.push("/")}
                        disabled={Boolean(!hasMounted)}
                      >
                        Add Case
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => exportCategory("customBenchmarkCases")}
                        disabled={Boolean(!hasMounted)}
                      >
                        Export Custom Cases
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openCategoryImport("customBenchmarkCases")}
                        disabled={Boolean(!hasMounted)}
                      >
                        Import Custom Cases
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {renderCategoryImportPanel("customBenchmarkCases")}
                  <p className="text-xs text-muted-foreground">
                    Create a manual case in Single Case Execution, then save it to the case library for future benchmark runs.
                  </p>
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

                  <div className="space-y-5 max-h-[32rem] overflow-y-auto pr-1">
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">Default Benchmark Cases</p>
                        <p className="text-xs text-muted-foreground">
                          Built-in public Thermo Fisher-adapted and synthetic algorithm cases; no endorsement implied.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 gap-3">
                        {filteredDefaultBenchmarkCases.map(renderBenchmarkCaseButton)}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">Custom Cases</p>
                        <p className="text-xs text-muted-foreground">Browser-local cases saved from Single Case Execution or imported here.</p>
                      </div>
                      {customBenchmarkCases.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                          No custom cases yet. Add one from Single Case Execution.
                        </p>
                      ) : filteredCustomBenchmarkCases.length > 0 ? (
                        <div className="grid grid-cols-1 gap-3">
                          {filteredCustomBenchmarkCases.map(renderBenchmarkCaseButton)}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No custom cases match this filter.</p>
                      )}
                    </div>
                  </div>

                  {filteredBenchmarkCases.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No benchmark cases match this filter.</p>
                  ) : null}
                </CardContent>
              </Card>
              )}

              {/* Prompt Library */}
              {activeTab === "prompts" && (
              <Card id="prompt-library" className="scroll-mt-24">
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <CardTitle className="text-base">Prompt Library</CardTitle>
                      <CardDescription>Inspect and edit local prompt templates used by future benchmark runs</CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => exportCategory("promptTemplates")}
                        disabled={Boolean(!hasMounted)}
                      >
                        Export Prompts
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openCategoryImport("promptTemplates")}
                        disabled={Boolean(!hasMounted)}
                      >
                        Import Prompts
                      </Button>
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
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {renderCategoryImportPanel("promptTemplates")}
                  <p className="text-xs text-warning-foreground">
                    Prompt changes affect future benchmark runs only.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Prompt Library is the source of prompts for model-only benchmark configs and workflow steps.
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
              )}
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              {activeTab === "providers" && (
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
              )}

              {/* Evaluation Criteria */}
              {activeTab === "providers" && (
              <Card className="scroll-mt-24">
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <CardTitle className="text-base">Criteria Library</CardTitle>
                      <CardDescription>Inspect and customize the benchmark rubric used for reporting and ranking weights</CardDescription>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={addCriterion} disabled={Boolean(!hasMounted)}>
                      Add Criterion
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">Active scoring weight: {activeScoringWeight}</p>
                        <p className="text-xs text-muted-foreground">
                          Active scoring weights are normalized during ranking. Report-only criteria do not affect numeric score.
                        </p>
                      </div>
                      {activeScoringWeight !== 100 ? (
                        <Badge variant="outline">Weights normalize to 100</Badge>
                      ) : (
                        <Badge variant="secondary">Weights sum to 100</Badge>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Custom criteria are report-only unless connected to a scoring method.
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant={criteriaDisplayMode === "compact" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCriteriaDisplayMode("compact")}
                      disabled={Boolean(!hasMounted)}
                    >
                      Compact view
                    </Button>
                    <Button
                      type="button"
                      variant={criteriaDisplayMode === "detailed" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCriteriaDisplayMode("detailed")}
                      disabled={Boolean(!hasMounted)}
                    >
                      Detailed view
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={expandAllCriteria} disabled={Boolean(!hasMounted)}>
                      Expand all details
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={collapseAllCriteria} disabled={Boolean(!hasMounted)}>
                      Collapse all details
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={copyEvaluationRubric} disabled={Boolean(!hasMounted)}>
                      Copy Evaluation Rubric
                    </Button>
                  </div>
                  {criteriaCopyStatus ? (
                    <p className="text-xs text-muted-foreground">{criteriaCopyStatus}</p>
                  ) : null}

                  <div className="space-y-3">
                    {criteriaLibrary.map((criterion) => {
                      const isExpanded = Boolean(expandedCriterionIds[criterion.id])
                      const isEditing = editingCriterionId === criterion.id && criterionDraft
                      return (
                        <div key={criterion.id} className="rounded-lg border border-border p-3">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium text-sm text-foreground">{criterion.name}</p>
                                <span className="text-xs text-muted-foreground">
                                  {scoringMethodLabels[criterion.scoringMethod]} · {criterion.isDefault ? "Default" : "Custom"} ·{" "}
                                  {criterion.isReportOnly ? "Report-only" : "Numeric"} · Weight {criterion.weight}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {criterion.shortDescription || criterion.description}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Switch checked={criterion.enabled} onCheckedChange={() => toggleCriterionEnabled(criterion.id)} />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => toggleCriterionDetails(criterion.id)}
                                disabled={Boolean(!hasMounted)}
                              >
                                {isExpanded ? "Hide details" : "View details"}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => startEditingCriterion(criterion)}
                                disabled={Boolean(!hasMounted)}
                              >
                                Edit
                              </Button>
                              {criterion.isDefault ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => resetCriterion(criterion.id)}
                                  disabled={Boolean(!hasMounted)}
                                >
                                  Reset default
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => deleteCriterion(criterion.id)}
                                  disabled={Boolean(!hasMounted)}
                                >
                                  Delete
                                </Button>
                              )}
                            </div>
                          </div>

                          {isExpanded && criteriaDisplayMode === "detailed" ? (
                            <div className="mt-3 space-y-4 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                              <div>
                                <p className="font-medium text-foreground">Overview</p>
                                <p className="mt-1">{criterion.detailedDescription || criterion.details || criterion.description}</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <Badge variant="outline">{scoringMethodLabels[criterion.scoringMethod]}</Badge>
                                  <Badge variant={criterion.isReportOnly ? "outline" : "secondary"}>
                                    {criterion.isReportOnly ? "Report-only" : "Numeric scoring"}
                                  </Badge>
                                  <Badge variant="outline">Weight {criterion.weight}</Badge>
                                </div>
                                {criterion.isDefault && !criterion.isReportOnly ? (
                                  <p className="mt-2">
                                    Formula is fixed in this MVP. You can customize the weight, but not the scoring function.
                                  </p>
                                ) : null}
                                {!criterion.isDefault ? (
                                  <p className="mt-2">
                                    Custom criteria are report-only unless connected to a scoring method.
                                  </p>
                                ) : null}
                              </div>

                              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div>
                                  <p className="font-medium text-foreground">Source of Truth</p>
                                  {renderRubricList(criterion.sourceOfTruth)}
                                </div>
                                <div>
                                  <p className="font-medium text-foreground">Required Model Fields</p>
                                  {renderRubricList(criterion.requiredModelFields)}
                                </div>
                                <div>
                                  <p className="font-medium text-foreground">Reference Fields Used</p>
                                  {renderRubricList(criterion.referenceFieldsUsed)}
                                </div>
                                <div>
                                  <p className="font-medium text-foreground">Configurable Parameters</p>
                                  {renderRubricList(criterion.configurableParameters)}
                                </div>
                              </div>

                              <div>
                                <p className="font-medium text-foreground">Subcriteria</p>
                                <div className="mt-2 space-y-2">
                                  {criterion.subcriteria.length > 0 ? criterion.subcriteria.map((item) => (
                                    <div key={item.id} className="rounded-md border border-border bg-background/60 p-2">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-medium text-foreground">{item.name}</p>
                                        {renderScoredBadge(item.currentlyScored)}
                                      </div>
                                      <p className="mt-1">{item.description}</p>
                                      <p className="mt-1">Evidence: {item.expectedEvidence}</p>
                                      <p className="mt-1">Contribution: {item.scoreContributionDescription}</p>
                                    </div>
                                  )) : <p className="mt-2">No subcriteria specified.</p>}
                                </div>
                              </div>

                              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div>
                                  <p className="font-medium text-foreground">Penalties</p>
                                  <div className="mt-2 space-y-2">
                                    {criterion.penalties.length > 0 ? criterion.penalties.map((item) => (
                                      <div key={item.id} className="rounded-md border border-border bg-background/60 p-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="font-medium text-foreground">{item.name}</p>
                                          <Badge variant="outline">{item.severity}</Badge>
                                          {renderScoredBadge(item.currentlyScored)}
                                        </div>
                                        <p className="mt-1">{item.description}</p>
                                        <p className="mt-1">Penalty: {item.penaltyDescription}</p>
                                      </div>
                                    )) : <p className="mt-2">No penalty rules specified.</p>}
                                  </div>
                                </div>
                                <div>
                                  <p className="font-medium text-foreground">Caps</p>
                                  <div className="mt-2 space-y-2">
                                    {criterion.caps.length > 0 ? criterion.caps.map((item) => (
                                      <div key={item.id} className="rounded-md border border-border bg-background/60 p-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="font-medium text-foreground">{item.name}</p>
                                          {renderScoredBadge(item.currentlyScored)}
                                        </div>
                                        <p className="mt-1">{item.description}</p>
                                        <p className="mt-1">Cap: {item.capDescription}</p>
                                      </div>
                                    )) : <p className="mt-2">No cap rules specified.</p>}
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div>
                                  <p className="font-medium text-foreground">Example Pass</p>
                                  <p className="mt-1">{criterion.examplePass || "No example provided."}</p>
                                </div>
                                <div>
                                  <p className="font-medium text-foreground">Example Fail</p>
                                  <p className="mt-1">{criterion.exampleFail || "No example provided."}</p>
                                </div>
                              </div>

                              <div>
                                <p className="font-medium text-foreground">Limitations</p>
                                {renderRubricList(criterion.limitations)}
                              </div>
                            </div>
                          ) : null}

                          {isExpanded && criteriaDisplayMode === "compact" ? (
                            <div className="mt-3 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                              <p className="font-medium text-foreground">Overview</p>
                              <p className="mt-1">{criterion.shortDescription || criterion.description}</p>
                              <p className="mt-2">
                                Switch to Detailed view to inspect source fields, subcriteria, penalties, caps, examples, and limitations.
                              </p>
                            </div>
                          ) : null}

                          {isEditing ? (
                            <div className="mt-3 space-y-3 rounded-md border border-border p-3">
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div className="space-y-2">
                                  <Label className="text-xs">Name</Label>
                                  <Input
                                    value={criterionDraft.name}
                                    onChange={(event) => setCriterionDraft((current) => current ? { ...current, name: event.target.value } : current)}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-xs">Weight</Label>
                                  <Input
                                    type="number"
                                    value={criterionDraft.weight}
                                    min="0"
                                    max="100"
                                    onChange={(event) =>
                                      setCriterionDraft((current) =>
                                        current ? { ...current, weight: Number(event.target.value) } : current,
                                      )
                                    }
                                  />
                                </div>
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs">Description</Label>
                                <Input
                                  value={criterionDraft.description}
                                  onChange={(event) =>
                                    setCriterionDraft((current) =>
                                      current ? { ...current, description: event.target.value } : current,
                                    )
                                  }
                                />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs">Details</Label>
                                <textarea
                                  value={criterionDraft.details}
                                  onChange={(event) =>
                                    setCriterionDraft((current) =>
                                      current ? { ...current, details: event.target.value } : current,
                                    )
                                  }
                                  className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                />
                              </div>
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div className="space-y-2">
                                  <Label className="text-xs">Scoring method</Label>
                                  <select
                                    value={criterionDraft.scoringMethod}
                                    onChange={(event) =>
                                      setCriterionDraft((current) =>
                                        current
                                          ? { ...current, scoringMethod: event.target.value as EvaluationScoringMethod }
                                          : current,
                                      )
                                    }
                                    disabled={Boolean(criterion.isDefault)}
                                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                  >
                                    {Object.entries(scoringMethodLabels).map(([value, label]) => (
                                      <option key={value} value={value}>{label}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex items-center justify-between rounded-md border border-border p-3">
                                  <Label className="text-xs">Enabled</Label>
                                  <Switch
                                    checked={criterionDraft.enabled}
                                    onCheckedChange={(checked) =>
                                      setCriterionDraft((current) => current ? { ...current, enabled: checked } : current)
                                    }
                                  />
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button type="button" size="sm" onClick={saveCriterionDraft} disabled={Boolean(!hasMounted)}>
                                  Save Criterion
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setEditingCriterionId(null)
                                    setCriterionDraft(null)
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
              )}

              {/* Run Settings */}
              {activeTab === "run" && (
              <Card id="run-settings" className="scroll-mt-24">
                <CardHeader>
                  <CardTitle className="text-base">Run Settings</CardTitle>
                  <CardDescription>Configure benchmark execution parameters</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <Label htmlFor="default-model-only-prompt" className="text-sm font-medium">
                      Default prompt template for raw model baselines
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
                      Used for raw model baseline configs. Workflow prompts are selected per step.
                    </p>
                  </div>

                  <div className="space-y-3 rounded-lg border border-border p-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">Benchmark configuration groups</p>
                      <p className="text-xs text-muted-foreground">
                        Include raw models and workflows together in the same benchmark run.
                      </p>
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <div>
                        <Label className="text-sm font-medium">Include raw model baselines</Label>
                        <p className="text-xs text-muted-foreground">One baseline prompt run for each selected model.</p>
                      </div>
                      <Switch checked={includeRawModelBaselines} onCheckedChange={setIncludeRawModelBaselines} />
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <div>
                        <Label className="text-sm font-medium">Include structured prompt baselines</Label>
                        <p className="text-xs text-muted-foreground">One structured JSON prompt run for each selected model.</p>
                      </div>
                      <Switch
                        checked={includeStructuredPromptBaselines}
                        onCheckedChange={setIncludeStructuredPromptBaselines}
                      />
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <div>
                        <Label className="text-sm font-medium">Include enabled workflows</Label>
                        <p className="text-xs text-muted-foreground">Each enabled workflow becomes one benchmark config.</p>
                      </div>
                      <Switch checked={includeEnabledWorkflows} onCheckedChange={setIncludeEnabledWorkflows} />
                    </div>
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
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-border p-3">
                    <div className="md:col-span-2">
                      <p className="text-sm font-medium text-foreground">Run Controls</p>
                      <p className="text-xs text-muted-foreground">
                        Run Controls affect all benchmark execution. Multi-step workflows consume more API calls and may require longer delays.
                      </p>
                    </div>
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
                      <Label htmlFor="workflow-step-delay-ms" className="text-sm font-medium">Delay between workflow steps (ms)</Label>
                      <Input
                        id="workflow-step-delay-ms"
                        type="number"
                        value={workflowStepDelayMs}
                        onChange={(event) => setWorkflowStepDelayMs(event.target.value)}
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
                    <div className="space-y-2">
                      <Label htmlFor="retry-backoff-mode" className="text-sm font-medium">Retry backoff mode</Label>
                      <select
                        id="retry-backoff-mode"
                        value={retryBackoffMode}
                        onChange={(event) => setRetryBackoffMode(event.target.value as RunControls["retryBackoffMode"])}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="provider_hint">Provider hint</option>
                        <option value="exponential">Exponential</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="max-output-tokens" className="text-sm font-medium">Max output tokens</Label>
                      <Input
                        id="max-output-tokens"
                        type="number"
                        value={maxOutputTokens}
                        onChange={(event) => setMaxOutputTokens(event.target.value)}
                        min="100"
                        max="2000"
                        step="100"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="stop-failure-rate" className="text-sm font-medium">Stop after failure rate (%)</Label>
                      <Input
                        id="stop-failure-rate"
                        type="number"
                        value={stopAfterFailureRatePercent}
                        onChange={(event) => setStopAfterFailureRatePercent(event.target.value)}
                        min="0"
                        max="100"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="max-configs-per-run" className="text-sm font-medium">Max configs per run</Label>
                      <Input
                        id="max-configs-per-run"
                        type="number"
                        value={maxConfigsPerRun}
                        onChange={(event) => setMaxConfigsPerRun(event.target.value)}
                        min="1"
                        max="100"
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border p-3">
                      <div>
                        <Label className="text-sm font-medium">Continue on error</Label>
                        <p className="text-xs text-muted-foreground">Keep partial successful results visible.</p>
                      </div>
                      <Switch checked={continueOnError} onCheckedChange={setContinueOnError} />
                    </div>
                    <p className="md:col-span-2 text-xs text-muted-foreground">
                      Free/on-demand provider tiers may rate-limit larger runs. Use fewer cases/models or increase delay.
                    </p>
                  </div>
                  
                </CardContent>
              </Card>
              )}
            </div>
          </div>
          )}

          {/* Configuration Summary */}
          {activeTab === "summary" && (
          <Card id="configuration-summary" className="mx-auto mt-6 max-w-5xl scroll-mt-24">
            <CardHeader>
              <CardTitle className="text-base">Planned Benchmark Run</CardTitle>
              <CardDescription>Preview benchmark configurations, run controls, and request shape before execution</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Provider</p>
                  <p className="text-sm font-medium">{selectedProviderLabel}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Selected cases</p>
                  <p className="text-sm font-medium">{summaryCaseCount}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Selected model count</p>
                  <p className="text-sm font-medium">{selectedModels.length}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Model-only configs</p>
                  <p className="text-sm font-medium">{modelOnlyConfigCount}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Workflow configs</p>
                  <p className="text-sm font-medium">{workflowConfigCount}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Total benchmark configs</p>
                  <p className="text-sm font-medium">{allSummaryBenchmarkConfigs.length}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Estimated LLM calls</p>
                  <p className="text-sm font-medium">{summaryEstimatedCalls}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Estimated risk level</p>
                  <p className="text-sm font-medium capitalize">{summaryRiskLevel}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Run Controls</p>
                  <p className="text-sm font-medium">{summaryRunControls.delayBetweenCallsMs} ms / {summaryRunControls.maxRetries} retries</p>
                </div>
              </div>

              <div className="mb-6 rounded-lg border border-border p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Workspace Sharing</p>
                    <p className="text-xs text-muted-foreground">
                      Full workspace export/import, including benchmark history, is also available in Reports.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={exportFullWorkspace}
                      disabled={Boolean(!hasMounted)}
                    >
                      Export Full Workspace
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => router.push("/reports")}
                      disabled={Boolean(!hasMounted)}
                    >
                      Import Workspace
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mb-6 rounded-lg border border-border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Config list</p>
                <div className="flex flex-wrap gap-2">
                  {allSummaryBenchmarkConfigs.length > 0 ? (
                    allSummaryBenchmarkConfigs.map((config) => (
                      <Badge key={config.configId} variant={config.configType === "workflow" ? "secondary" : "outline"}>
                        {config.label}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">No configs selected</span>
                  )}
                </div>
              </div>

              <div className="mb-6 rounded-lg border border-border p-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRequestPayload((current) => !current)}
                  disabled={Boolean(!hasMounted)}
                >
                  {showRequestPayload ? "Hide request payload" : "Show request payload"}
                </Button>
                {showRequestPayload ? (
                  <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(summaryRequestPayload, null, 2)}
                  </pre>
                ) : null}
              </div>

              {showBenchmarkProgress ? (
                <div className="mb-6 rounded-lg border border-border p-4">
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Benchmark Progress</p>
                      <p className="text-xs text-muted-foreground">{benchmarkProgress.currentStatus}</p>
                    </div>
                    <Badge variant={benchmarkProgress.currentStatus === "Benchmark failed" ? "destructive" : "outline"}>
                      {benchmarkProgress.progressPercent}%
                    </Badge>
                  </div>

                  <Progress value={benchmarkProgress.progressPercent} className="mb-4" />

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-md bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">Elapsed time</p>
                      <p className="text-sm font-medium">{formatDuration(benchmarkProgress.elapsedSeconds)}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">Estimated remaining</p>
                      <p className="text-sm font-medium">
                        {benchmarkProgress.isRunning
                          ? formatDuration(benchmarkProgress.estimatedRemainingSeconds)
                          : benchmarkProgress.currentStatus === "Benchmark completed"
                            ? "0s"
                            : "N/A"}
                      </p>
                    </div>
                    <div className="rounded-md bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">Estimated LLM calls</p>
                      <p className="text-sm font-medium">{benchmarkProgress.estimatedTotalCalls}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">Benchmark configs</p>
                      <p className="text-sm font-medium">{allSummaryBenchmarkConfigs.length}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">Cases</p>
                      <p className="text-sm font-medium">{summaryCaseCount}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">Estimated steps</p>
                      <p className="text-sm font-medium">{benchmarkProgress.estimatedTotalSteps || summaryEstimatedSteps}</p>
                    </div>
                  </div>

                  {(benchmarkProgress.currentCaseLabel || benchmarkProgress.currentConfigLabel) ? (
                    <div className="mt-3 rounded-md border border-border p-3 text-xs text-muted-foreground">
                      {benchmarkProgress.currentCaseLabel ? <p>Starting case: {benchmarkProgress.currentCaseLabel}</p> : null}
                      {benchmarkProgress.currentConfigLabel ? <p>Starting config: {benchmarkProgress.currentConfigLabel}</p> : null}
                    </div>
                  ) : null}

                  {benchmarkProgress.warning ? (
                    <p className="mt-3 text-sm text-amber-600">{benchmarkProgress.warning}</p>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-3">
                    {benchmarkResultsReady ? (
                      <Button type="button" className="gap-2" onClick={() => router.push("/benchmark-results")}>
                        View Benchmark Results
                      </Button>
                    ) : null}
                    {!benchmarkProgress.isRunning && benchmarkProgress.startedAt ? (
                      <Button type="button" variant="outline" onClick={resetBenchmarkProgress}>
                        Reset progress
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

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
                      <span className="text-sm text-muted-foreground">No model baselines selected</span>
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
                    Used by raw model baselines. Workflow prompts are selected per step.
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Benchmark Configurations</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">Total configs: {totalBenchmarkConfigCount}</Badge>
                    <Badge variant="outline">Model-only configs: {modelOnlyConfigCount}</Badge>
                    <Badge variant="outline">Workflow configs: {workflowConfigCount}</Badge>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {selectedModels.length > 0 && includeRawModelBaselines
                      ? selectedModels.map((modelId) => <p key={`raw-${modelId}`}>Raw: {modelId}</p>)
                      : null}
                    {selectedModels.length > 0 && includeStructuredPromptBaselines
                      ? selectedModels.map((modelId) => <p key={`structured-${modelId}`}>Structured: {modelId}</p>)
                      : null}
                    {includeEnabledWorkflows
                      ? enabledSummaryWorkflows.map((workflow) => (
                          <p key={`workflow-${workflow.id}`}>Workflow: {workflow.name}</p>
                        ))
                      : null}
                    {totalBenchmarkConfigCount === 0 ? <p>No benchmark configs selected</p> : null}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Evaluation Workflows</p>
                  <div className="flex flex-wrap gap-2">
                    {includeEnabledWorkflows && enabledSummaryWorkflows.length > 0 ? (
                      enabledSummaryWorkflows
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
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {activeScoringCriteria.length > 0 ? (
                        activeScoringCriteria.map((criterion) => (
                          <Badge key={criterion.id} variant="secondary">
                            {criterion.name}: {criterion.weight}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">No scoring criteria enabled</span>
                      )}
                    </div>
                    {reportOnlyCriteria.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {reportOnlyCriteria.map((criterion) => (
                          <Badge key={criterion.id} variant="outline">
                            Report-only: {criterion.name}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Active scoring weight: {activeScoringWeight}. Weights are normalized during ranking.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveTab("providers")}
                      disabled={Boolean(!hasMounted)}
                    >
                      View full rubric
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Run Settings</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{selectedBenchmarkCaseIds.length || allBenchmarkCases.length} benchmark cases</Badge>
                    <Badge variant="outline">Batch</Badge>
                    <Badge variant="outline">{summaryDelayMs} ms delay</Badge>
                    <Badge variant="outline">{summaryRunControls.delayBetweenWorkflowStepsMs} ms step delay</Badge>
                    <Badge variant="outline">{summaryMaxRetries} retries</Badge>
                    <Badge variant="outline">{summaryRunControls.maxOutputTokens} max tokens</Badge>
                    <Badge variant="outline">{summaryRunControls.retryBackoffMode}</Badge>
                    <Badge variant="outline">Browser history</Badge>
                    <Badge variant="outline">Report</Badge>
                  </div>
                </div>
              </div>
              
              {runValidationMessage ? (
                <div className="mt-6 border-t border-border pt-4">
                  <p className="text-sm text-destructive">{runValidationMessage}</p>
                </div>
              ) : null}

              <div className="flex gap-3 mt-6 pt-4 border-t border-border">
                <Button className="gap-2" onClick={runBenchmark} disabled={Boolean(!hasMounted || benchmarkRunning || runValidationMessage)}>
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
                MVP note: batch runs now evaluate the selected benchmark configurations together, including raw baselines, structured baselines, and enabled workflows.
              </p>
            </CardContent>
          </Card>
          )}
        </main>
      </div>
    </div>
  )
}
