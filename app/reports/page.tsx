"use client"

import { useEffect, useMemo, useState } from "react"

import { Header } from "@/components/dashboard/header"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  CloudBenchmarkRunError,
  isCloudBenchmarkRunsConfigured,
  isCloudRunId,
  loadBenchmarkRunFromCloud,
  saveBenchmarkRunToCloud,
  type SaveBenchmarkRunResult,
} from "@/lib/cloud-benchmark-runs"
import {
  EVALUATION_CRITERIA_STORAGE_KEY,
  LATEST_EVALUATION_CRITERIA_STORAGE_KEY,
  getActiveScoringWeight,
  getNormalizedCriterionWeights,
  getReportOnlyCriteria,
  getScoringCriteria,
  parseEvaluationCriteria,
  type EvaluationCriterion,
} from "@/lib/evaluation-criteria"
import type { EvaluationResponse, LlmEvaluationResult } from "@/lib/types"
import {
  BENCHMARK_RUN_HISTORY_STORAGE_KEY,
  WORKSPACE_SCHEMA_VERSION,
  applyWorkspaceImport,
  buildMergedBatchFromRuns,
  buildWorkspaceImportPreview,
  caseConfigReplicateKey,
  caseIdentityKey,
  configIdentityKey,
  createWorkspaceExport,
  isRunCompatible,
  parseWorkspaceExport,
  readBenchmarkRunHistory,
  stableStringify,
  toBenchmarkRunHistoryEntry,
  writeBenchmarkRunHistory,
  type BenchmarkRunHistoryEntry,
  type WorkspaceCategory,
  type WorkspaceConflictAction,
  type WorkspaceExport,
  type WorkspaceExportData,
  type WorkspaceImportPreview,
  type WorkspaceMergeMode,
} from "@/lib/workspace-sharing"
import {
  AlertOctagon,
  AlertTriangle,
  Award,
  Brain,
  CheckCircle2,
  Cloud,
  Copy,
  Download,
  FileText,
  Info,
  Loader2,
  Save,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react"

type BatchEvaluationResponse = {
  batchId: string
  createdAt: string
  providerId: "openrouter" | "groq"
  caseCount: number
  modelCount: number
  selectedModelCount?: number
  configCount?: number
  totalConfigCount?: number
  benchmarkConfigs?: unknown[]
  runControls?: unknown
  cases: Array<{
    caseId: string
    title: string
    sourceType: "thermo_case_adapted" | "synthetic_algorithm_case"
    tags: string[]
    expectedReferenceLabel: EvaluationResponse["referenceDecision"]["recommendation"]
    caseData: EvaluationResponse["caseData"]
    referenceDecision: EvaluationResponse["referenceDecision"]
    referenceChecks: NonNullable<EvaluationResponse["referenceChecks"]>
    results: LlmEvaluationResult[]
  }>
  criteriaSettings?: EvaluationCriterion[]
  aggregate: {
    averageRecommendationMatch: number | null
    averageCriterionAlignment: number | null
    averageSafety: number | null
    averageExplainability: number | null
    totalSafetyWarnings: number
    failedModelCalls: number
  }
}

type ReportScope = "latest" | "merged" | "compatible" | "all"

const STORAGE_KEYS = {
  customBenchmarkCases: "customBenchmarkCases",
  evaluationWorkflows: "evaluationWorkflows",
  promptTemplates: "promptTemplates",
  evaluationCriteria: EVALUATION_CRITERIA_STORAGE_KEY,
  evaluationSettings: "evaluationSettings",
  latestBatchEvaluationResponse: "latestBatchEvaluationResponse",
  latestSingleCaseExecutionResponse: "latestSingleCaseExecutionResponse",
}

const WORKSPACE_CATEGORIES: Array<{ id: WorkspaceCategory; label: string }> = [
  { id: "customBenchmarkCases", label: "Custom cases" },
  { id: "evaluationWorkflows", label: "Workflows" },
  { id: "promptTemplates", label: "Prompts" },
  { id: "evaluationCriteria", label: "Criteria" },
  { id: "evaluationSettings", label: "Evaluation settings" },
  { id: "benchmarkRunHistory", label: "Benchmark run history" },
  { id: "singleCaseResults", label: "Single-case results" },
]

const CLOUD_RUN_IMPORT_CATEGORIES: Record<WorkspaceCategory, boolean> = {
  customBenchmarkCases: false,
  evaluationWorkflows: false,
  promptTemplates: false,
  evaluationCriteria: false,
  evaluationSettings: false,
  benchmarkRunHistory: true,
  singleCaseResults: false,
}

type CloudNotice = {
  kind: "success" | "error" | "info"
  message: string
}

function getCloudErrorMessage(error: unknown, operation: "save" | "load"): string {
  if (error instanceof CloudBenchmarkRunError) {
    if (error.code === "INVALID_RUN_ID") return "Enter a valid Cloud Run ID."
    if (error.code === "NOT_FOUND") return "Cloud run not found."
    if (error.code === "CONFLICT") {
      return operation === "save"
        ? "Cloud save failed because the generated ID already contains different content. Your local benchmark result is unchanged."
        : "Cloud load failed because the Cloud Run ID conflicts with existing content. Your local benchmark history is unchanged."
    }
    if (error.code === "ARTIFACT_REJECTED") {
      return operation === "save"
        ? "Cloud save failed because the artifact was rejected. Your local benchmark result is unchanged."
        : "Cloud load failed because the returned artifact was rejected. Your local benchmark history is unchanged."
    }
    if (error.code === "TIMEOUT") {
      return operation === "save"
        ? "Cloud save timed out. Your local benchmark result is unchanged."
        : "Cloud load timed out. Your local benchmark history is unchanged."
    }
    if (error.code === "NOT_CONFIGURED") return "Cloud persistence is not configured."
  }

  return operation === "save"
    ? "Cloud save failed. Your local benchmark result is unchanged."
    : "Cloud load failed. Your local benchmark history is unchanged."
}

type ModelRanking = {
  configId: string
  modelLabel: string
  configLabel?: string
  configType?: string
  workflowType?: string
  workflowName?: string
  workflowStepCount?: number
  toolAssisted?: boolean
  averageRecommendationMatch: number | null
  averageCriterionAlignment: number | null
  averageSafety: number | null
  averageExplainability: number | null
  weightedScore: number
  failedCalls: number
  casesEvaluated: number
}

type ReplicatePairDetail = {
  pairKey: string
  configKey: string
  caseKey: string
  caseTitle: string
  runCount: number
  recommendationDistribution: Record<string, number>
  confidenceDistribution: Record<string, number>
  majorityRecommendation: string
  majorityRecommendationCount: number
  recommendationConsistencyRate: number
  meanWeightedScore: number | null
  minWeightedScore: number | null
  maxWeightedScore: number | null
  failedRunCount: number
  unsafeWarningCount: number
}

type ConfigReplicateAggregate = {
  configKey: string
  label: string
  configType: string
  observationCount: number
  uniqueCaseCount: number
  totalReplicateCount: number
  averageReplicatesPerCase: number
  meanRecommendationMatch: number | null
  meanCriterionAlignment: number | null
  meanSafety: number | null
  meanExplainability: number | null
  meanWeightedScore: number | null
  scoreStdDev: number | null
  failedCallRate: number
  unsafeOutputRate: number
  recommendationConsistencyMean: number | null
  replicatedPairs: ReplicatePairDetail[]
}

type ReplicateSummary = {
  totalRuns: number
  totalObservations: number
  uniqueCaseConfigPairs: number
  replicatedPairs: number
  averageReplicatesPerPair: number
  averageRecommendationConsistency: number | null
  configs: ConfigReplicateAggregate[]
}

type WeakCase = {
  caseId: string
  title: string
  expectedReferenceLabel: string
  averageCriterionAlignment: number | null
  failedCalls: number
}

type FindingItem = {
  id?: string
  configId?: string
  caseId?: string
  type?: string
  text: string
}

const mockRankings: ModelRanking[] = [
  {
    configId: "mock-gpt-verification",
    modelLabel: "GPT-4 + Verification Workflow",
    averageRecommendationMatch: 94.5,
    averageCriterionAlignment: 91.2,
    averageSafety: 96,
    averageExplainability: 88.3,
    weightedScore: 92.8,
    failedCalls: 0,
    casesEvaluated: 48,
  },
  {
    configId: "mock-claude-structured",
    modelLabel: "Claude + Structured Output",
    averageRecommendationMatch: 89.2,
    averageCriterionAlignment: 87.8,
    averageSafety: 92.5,
    averageExplainability: 86.7,
    weightedScore: 89.2,
    failedCalls: 1,
    casesEvaluated: 48,
  },
  {
    configId: "mock-llama-baseline",
    modelLabel: "Llama 3 + Baseline",
    averageRecommendationMatch: 71.5,
    averageCriterionAlignment: 68.9,
    averageSafety: 72,
    averageExplainability: 68.4,
    weightedScore: 70.4,
    failedCalls: 3,
    casesEvaluated: 48,
  },
]

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function formatScore(value: number | null | undefined): string {
  return value === null || value === undefined ? "N/A" : `${value.toFixed(1)}%`
}

function formatNumber(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "N/A" : value.toFixed(digits)
}

function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? "N/A" : `${(value * 100).toFixed(1)}%`
}

function formatDate(value: string | undefined): string {
  if (!value) return "N/A"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function readLocalWorkspaceData(): WorkspaceExportData {
  const latestBatch = safeParse<Record<string, unknown> | undefined>(
    sessionStorage.getItem(STORAGE_KEYS.latestBatchEvaluationResponse),
    undefined,
  )
  const latestSingle = safeParse<Record<string, unknown> | undefined>(
    sessionStorage.getItem(STORAGE_KEYS.latestSingleCaseExecutionResponse),
    undefined,
  )
  const history = readBenchmarkRunHistory(localStorage)
  const nextHistory =
    latestBatch && typeof latestBatch.batchId === "string"
      ? appendLatestBatchToHistory(history, latestBatch)
      : history

  if (nextHistory.length !== history.length) {
    writeBenchmarkRunHistory(localStorage, nextHistory)
  }

  return {
    customBenchmarkCases: safeParse(localStorage.getItem(STORAGE_KEYS.customBenchmarkCases), []),
    evaluationWorkflows: safeParse(localStorage.getItem(STORAGE_KEYS.evaluationWorkflows), []),
    promptTemplates: safeParse(localStorage.getItem(STORAGE_KEYS.promptTemplates), []),
    evaluationCriteria: parseEvaluationCriteria(localStorage.getItem(STORAGE_KEYS.evaluationCriteria)),
    evaluationSettings: safeParse(localStorage.getItem(STORAGE_KEYS.evaluationSettings), undefined),
    benchmarkRunHistory: nextHistory,
    latestBatchEvaluationResponse: latestBatch,
    latestSingleCaseExecutionResponse: latestSingle,
  }
}

function appendLatestBatchToHistory(history: BenchmarkRunHistoryEntry[], latestBatch: Record<string, unknown>) {
  const entry = toBenchmarkRunHistoryEntry({
    batch: latestBatch,
    criteriaSnapshot: safeParse(localStorage.getItem(STORAGE_KEYS.evaluationCriteria), undefined),
    promptTemplatesSnapshot: safeParse(localStorage.getItem(STORAGE_KEYS.promptTemplates), undefined),
    workflowsSnapshot: safeParse(localStorage.getItem(STORAGE_KEYS.evaluationWorkflows), undefined),
  })
  const existing = history.find((run) => run.batchId === entry.batchId)
  if (existing && stableStringify(existing.rawBatch) === stableStringify(entry.rawBatch)) return history
  return existing ? [...history, { ...entry, batchId: `${entry.batchId}-local-${Date.now()}` }] : [...history, entry]
}

function writeWorkspaceData(data: WorkspaceExportData) {
  if (data.customBenchmarkCases) {
    localStorage.setItem(STORAGE_KEYS.customBenchmarkCases, JSON.stringify(data.customBenchmarkCases))
  }
  if (data.evaluationWorkflows) {
    localStorage.setItem(STORAGE_KEYS.evaluationWorkflows, JSON.stringify(data.evaluationWorkflows))
  }
  if (data.promptTemplates) {
    localStorage.setItem(STORAGE_KEYS.promptTemplates, JSON.stringify(data.promptTemplates))
  }
  if (data.evaluationCriteria) {
    localStorage.setItem(STORAGE_KEYS.evaluationCriteria, JSON.stringify(data.evaluationCriteria))
  }
  if (data.evaluationSettings) {
    localStorage.setItem(STORAGE_KEYS.evaluationSettings, JSON.stringify(data.evaluationSettings))
  }
  if (data.benchmarkRunHistory) {
    localStorage.setItem(BENCHMARK_RUN_HISTORY_STORAGE_KEY, JSON.stringify(data.benchmarkRunHistory))
  }
  if (data.latestBatchEvaluationResponse) {
    sessionStorage.setItem(STORAGE_KEYS.latestBatchEvaluationResponse, JSON.stringify(data.latestBatchEvaluationResponse))
  }
  if (data.latestSingleCaseExecutionResponse) {
    sessionStorage.setItem(
      STORAGE_KEYS.latestSingleCaseExecutionResponse,
      JSON.stringify(data.latestSingleCaseExecutionResponse),
    )
  }
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function getCompatibleRuns(runs: BenchmarkRunHistoryEntry[], criteria: EvaluationCriterion[]) {
  return runs.filter((run) => isRunCompatible(run, criteria) === true)
}

function castBatch(value: Record<string, unknown> | null): BatchEvaluationResponse | null {
  return value ? (value as unknown as BatchEvaluationResponse) : null
}

function scoreOrZero(value: number | null): number {
  return value ?? 0
}

function getWeightedScore(
  model: Pick<ModelRanking, "averageRecommendationMatch" | "averageCriterionAlignment" | "averageSafety" | "averageExplainability">,
  criteria: EvaluationCriterion[],
): number {
  const normalizedWeights = getNormalizedCriterionWeights(criteria)
  const weightedValues = [
    scoreOrZero(model.averageRecommendationMatch) * (normalizedWeights["recommendation-match"] ?? 0),
    scoreOrZero(model.averageCriterionAlignment) * (normalizedWeights["criterion-alignment"] ?? 0),
    scoreOrZero(model.averageSafety) * (normalizedWeights["safety-risk-detection"] ?? 0),
    scoreOrZero(model.averageExplainability) * (normalizedWeights.explainability ?? 0),
  ]
  return weightedValues.reduce((sum, value) => sum + value, 0)
}

function buildModelRankings(batch: BatchEvaluationResponse, criteria: EvaluationCriterion[]): ModelRanking[] {
  const allResults = batch.cases.flatMap((caseResult) => caseResult.results)
  const configIds = Array.from(new Set(allResults.map((result) => result.configId)))

  return configIds
    .map((configId) => {
      const modelResults = allResults.filter((result) => result.configId === configId)
      const scored = modelResults.filter(
        (result): result is LlmEvaluationResult & { scores: NonNullable<LlmEvaluationResult["scores"]> } =>
          result.status === "success" && !!result.scores,
      )
      const ranking = {
        configId,
        modelLabel: modelResults[0]?.modelLabel ?? configId,
        configLabel: modelResults[0]?.configLabel,
        configType: modelResults[0]?.configType,
        workflowType: modelResults[0]?.workflowType,
        workflowName: modelResults[0]?.workflowName,
        workflowStepCount: modelResults[0]?.workflowStepCount,
        toolAssisted: modelResults[0]?.toolAssisted,
        averageRecommendationMatch: average(scored.map((result) => result.scores.recommendationMatch ?? 0)),
        averageCriterionAlignment: average(scored.map((result) => result.scores.alignment)),
        averageSafety: average(scored.map((result) => result.scores.safety)),
        averageExplainability: average(scored.map((result) => result.scores.explainability)),
        weightedScore: 0,
        failedCalls: modelResults.filter((result) => result.status === "error").length,
        casesEvaluated: modelResults.length,
      }

      return { ...ranking, weightedScore: getWeightedScore(ranking, criteria) }
    })
    .sort((a, b) => b.weightedScore - a.weightedScore)
}

function stdDev(values: number[]): number | null {
  if (values.length < 2) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function incrementDistribution(distribution: Record<string, number>, key: string) {
  distribution[key] = (distribution[key] ?? 0) + 1
}

function getMajority(distribution: Record<string, number>) {
  const entries = Object.entries(distribution).sort((a, b) => b[1] - a[1])
  return { label: entries[0]?.[0] ?? "unknown", count: entries[0]?.[1] ?? 0 }
}

function formatDistribution(distribution: Record<string, number>, total: number): string {
  if (total <= 0) return "N/A"
  return Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${label}: ${count} (${((count / total) * 100).toFixed(0)}%)`)
    .join(" | ")
}

function getWeightedScoreFromResult(result: LlmEvaluationResult, criteria: EvaluationCriterion[]): number | null {
  if (!result.scores) return null
  return getWeightedScore(
    {
      averageRecommendationMatch: result.scores.recommendationMatch ?? null,
      averageCriterionAlignment: result.scores.alignment,
      averageSafety: result.scores.safety,
      averageExplainability: result.scores.explainability,
    },
    criteria,
  )
}

function buildReplicateSummary(runs: BenchmarkRunHistoryEntry[], criteria: EvaluationCriterion[]): ReplicateSummary {
  const observations = runs.flatMap((run) =>
    run.cases.flatMap((caseResult) => {
      const results = Array.isArray(caseResult.results) ? (caseResult.results as LlmEvaluationResult[]) : []
      return results.map((result) => {
        const caseRecord = caseResult as Record<string, unknown>
        const resultRecord = result as unknown as Record<string, unknown>
        return {
          run,
          caseResult: caseRecord,
          result,
          configKey: configIdentityKey({ run, result: resultRecord }),
          caseKey: caseIdentityKey(caseRecord),
          pairKey: caseConfigReplicateKey({ run, caseResult: caseRecord, result: resultRecord }),
          weightedScore: getWeightedScoreFromResult(result, criteria),
        }
      })
    }),
  )

  const pairMap = new Map<string, typeof observations>()
  for (const observation of observations) {
    const current = pairMap.get(observation.pairKey) ?? []
    current.push(observation)
    pairMap.set(observation.pairKey, current)
  }

  const pairDetails = Array.from(pairMap.entries()).map(([pairKey, pairObservations]) => {
    const recommendationDistribution: Record<string, number> = {}
    const confidenceDistribution: Record<string, number> = {}
    const weightedScores = pairObservations
      .map((observation) => observation.weightedScore)
      .filter((value): value is number => typeof value === "number")
    const unsafeWarningCount = pairObservations.reduce(
      (sum, observation) => sum + (observation.result.parsedOutput?.safety_warnings?.length ?? 0),
      0,
    )

    for (const observation of pairObservations) {
      incrementDistribution(
        recommendationDistribution,
        observation.result.status === "success"
          ? observation.result.parsedOutput?.recommendation ?? "unknown/unparsed"
          : "unknown/unparsed",
      )
      incrementDistribution(confidenceDistribution, observation.result.parsedOutput?.confidence ?? "unknown")
    }

    const majority = getMajority(recommendationDistribution)
    return {
      pairKey,
      configKey: pairObservations[0]?.configKey ?? "unknown-config",
      caseKey: pairObservations[0]?.caseKey ?? "unknown-case",
      caseTitle: String(pairObservations[0]?.caseResult.title ?? pairObservations[0]?.caseKey ?? "Untitled case"),
      runCount: pairObservations.length,
      recommendationDistribution,
      confidenceDistribution,
      majorityRecommendation: majority.label,
      majorityRecommendationCount: majority.count,
      recommendationConsistencyRate: pairObservations.length > 0 ? majority.count / pairObservations.length : 0,
      meanWeightedScore: average(weightedScores),
      minWeightedScore: weightedScores.length > 0 ? Math.min(...weightedScores) : null,
      maxWeightedScore: weightedScores.length > 0 ? Math.max(...weightedScores) : null,
      failedRunCount: pairObservations.filter((observation) => observation.result.status === "error").length,
      unsafeWarningCount,
    }
  })

  const configMap = new Map<string, typeof observations>()
  for (const observation of observations) {
    const current = configMap.get(observation.configKey) ?? []
    current.push(observation)
    configMap.set(observation.configKey, current)
  }

  const configs = Array.from(configMap.entries())
    .map(([configKey, configObservations]) => {
      const pairRows = pairDetails.filter((pair) => pair.configKey === configKey)
      const scored = configObservations.filter((observation) => observation.result.scores)
      const weightedScores = configObservations
        .map((observation) => observation.weightedScore)
        .filter((value): value is number => typeof value === "number")
      const unsafeCount = configObservations.filter(
        (observation) => (observation.result.parsedOutput?.safety_warnings?.length ?? 0) > 0,
      ).length
      const first = configObservations[0]?.result
      const uniqueCaseCount = new Set(configObservations.map((observation) => observation.caseKey)).size
      const replicatedPairs = pairRows.filter((pair) => pair.runCount > 1)

      return {
        configKey,
        label: first?.configLabel ?? first?.modelLabel ?? configKey,
        configType: first?.configType ?? "unknown",
        observationCount: configObservations.length,
        uniqueCaseCount,
        totalReplicateCount: Math.max(0, configObservations.length - uniqueCaseCount),
        averageReplicatesPerCase: uniqueCaseCount > 0 ? configObservations.length / uniqueCaseCount : 0,
        meanRecommendationMatch: average(scored.map((observation) => observation.result.scores?.recommendationMatch ?? 0)),
        meanCriterionAlignment: average(scored.map((observation) => observation.result.scores?.alignment ?? 0)),
        meanSafety: average(scored.map((observation) => observation.result.scores?.safety ?? 0)),
        meanExplainability: average(scored.map((observation) => observation.result.scores?.explainability ?? 0)),
        meanWeightedScore: average(weightedScores),
        scoreStdDev: stdDev(weightedScores),
        failedCallRate:
          configObservations.length > 0
            ? configObservations.filter((observation) => observation.result.status === "error").length /
              configObservations.length
            : 0,
        unsafeOutputRate: configObservations.length > 0 ? unsafeCount / configObservations.length : 0,
        recommendationConsistencyMean: average(pairRows.map((pair) => pair.recommendationConsistencyRate * 100)),
        replicatedPairs,
      }
    })
    .sort((a, b) => scoreOrZero(b.meanWeightedScore) - scoreOrZero(a.meanWeightedScore))

  const replicatedPairRows = pairDetails.filter((pair) => pair.runCount > 1)
  return {
    totalRuns: runs.length,
    totalObservations: observations.length,
    uniqueCaseConfigPairs: pairDetails.length,
    replicatedPairs: replicatedPairRows.length,
    averageReplicatesPerPair:
      pairDetails.length > 0
        ? pairDetails.reduce((sum, pair) => sum + pair.runCount, 0) / pairDetails.length
        : 0,
    averageRecommendationConsistency: average(pairDetails.map((pair) => pair.recommendationConsistencyRate * 100)),
    configs,
  }
}

function buildWeakestCases(batch: BatchEvaluationResponse): WeakCase[] {
  return batch.cases
    .map((caseResult) => {
      const scored = caseResult.results.filter(
        (result): result is LlmEvaluationResult & { scores: NonNullable<LlmEvaluationResult["scores"]> } =>
          result.status === "success" && !!result.scores,
      )

      return {
        caseId: caseResult.caseId,
        title: caseResult.title,
        expectedReferenceLabel: caseResult.expectedReferenceLabel,
        averageCriterionAlignment: average(scored.map((result) => result.scores.alignment)),
        failedCalls: caseResult.results.filter((result) => result.status === "error").length,
      }
    })
    .sort((a, b) => scoreOrZero(a.averageCriterionAlignment) - scoreOrZero(b.averageCriterionAlignment))
    .slice(0, 5)
}

function getUnsafeRecommendationExamples(batch: BatchEvaluationResponse) {
  return batch.cases.flatMap((caseResult) =>
    caseResult.results
      .filter(
        (result) =>
          result.status === "success" &&
          result.parsedOutput?.recommendation === "consider_discontinuation" &&
          caseResult.referenceDecision.recommendation !== "consider_discontinuation",
      )
      .map((result) => ({
        configId: result.configId,
        caseId: caseResult.caseId,
        type: "unsafe_recommendation",
        caseTitle: caseResult.title,
        modelLabel: result.modelLabel,
        reference: caseResult.referenceDecision.recommendation,
      })),
  )
}

function getMatchedButLowCriterionExamples(batch: BatchEvaluationResponse) {
  return batch.cases.flatMap((caseResult) =>
    caseResult.results
      .filter(
        (result) =>
          result.status === "success" &&
          result.parsedOutput?.recommendation === caseResult.referenceDecision.recommendation &&
          typeof result.scores?.alignment === "number" &&
          result.scores.alignment < 70,
      )
      .map((result) => ({
        configId: result.configId,
        caseId: caseResult.caseId,
        type: "matched_low_criterion",
        caseTitle: caseResult.title,
        modelLabel: result.modelLabel,
        alignment: result.scores?.alignment ?? null,
      })),
  )
}

function getFailedCalls(batch: BatchEvaluationResponse) {
  return batch.cases.flatMap((caseResult) =>
    caseResult.results
      .filter((result) => result.status === "error")
      .map((result) => ({
        configId: result.configId,
        caseId: caseResult.caseId,
        type: "failed_call",
        caseTitle: caseResult.title,
        modelLabel: result.modelLabel,
        failureReason: result.failureReason ?? "unknown",
        error: result.error ?? "Unknown error",
      })),
  )
}

function ScoreBar({ score, label }: { score: number | null | undefined; label: string }) {
  const normalized = score ?? 0
  const getColor = (value: number) => {
    if (value >= 90) return "bg-success"
    if (value >= 80) return "bg-primary"
    if (value >= 70) return "bg-warning"
    return "bg-destructive"
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{formatScore(score)}</span>
      </div>
      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${getColor(normalized)}`} style={{ width: `${normalized}%` }} />
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const [batchResponse, setBatchResponse] = useState<BatchEvaluationResponse | null>(null)
  const [runHistory, setRunHistory] = useState<BenchmarkRunHistoryEntry[]>([])
  const [reportCriteria, setReportCriteria] = useState<EvaluationCriterion[]>(() => parseEvaluationCriteria(null))
  const [reportScope, setReportScope] = useState<ReportScope>("latest")
  const [importText, setImportText] = useState("")
  const [importPreview, setImportPreview] = useState<WorkspaceImportPreview | null>(null)
  const [importWorkspace, setImportWorkspace] = useState<WorkspaceExport | null>(null)
  const [importMode, setImportMode] = useState<WorkspaceMergeMode>("merge")
  const [importCategories, setImportCategories] = useState<Record<WorkspaceCategory, boolean>>({
    customBenchmarkCases: true,
    evaluationWorkflows: true,
    promptTemplates: true,
    evaluationCriteria: true,
    evaluationSettings: false,
    benchmarkRunHistory: true,
    singleCaseResults: false,
  })
  const [conflictActions, setConflictActions] = useState<Record<string, WorkspaceConflictAction>>({})
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null)
  const cloudPersistenceEnabled = isCloudBenchmarkRunsConfigured()
  const [cloudSelectedBatchId, setCloudSelectedBatchId] = useState("")
  const [cloudRunIdInput, setCloudRunIdInput] = useState("")
  const [cloudBusy, setCloudBusy] = useState<"save" | "load" | null>(null)
  const [cloudNotice, setCloudNotice] = useState<CloudNotice | null>(null)
  const [lastCloudSave, setLastCloudSave] = useState<SaveBenchmarkRunResult | null>(null)
  const [cloudConflictPending, setCloudConflictPending] = useState(false)

  useEffect(() => {
    try {
      const localData = readLocalWorkspaceData()
      const storedBatch = sessionStorage.getItem("latestBatchEvaluationResponse")
      const storedCriteria = sessionStorage.getItem(LATEST_EVALUATION_CRITERIA_STORAGE_KEY)
      const parsedBatch = storedBatch ? (JSON.parse(storedBatch) as BatchEvaluationResponse) : null
      setBatchResponse(parsedBatch)
      setRunHistory(localData.benchmarkRunHistory ?? [])
      setReportCriteria(
        parsedBatch?.criteriaSettings ??
          parseEvaluationCriteria(storedCriteria),
      )
    } catch {
      setBatchResponse(null)
      setRunHistory([])
      setReportCriteria(parseEvaluationCriteria(null))
    }
  }, [])

  useEffect(() => {
    setCloudSelectedBatchId((current) => {
      if (current && runHistory.some((run) => run.batchId === current)) return current
      return runHistory.length === 1 ? runHistory[0].batchId : ""
    })
  }, [runHistory])

  const runsForScope = useMemo(() => {
    if (reportScope === "latest") return []
    if (reportScope === "compatible") return getCompatibleRuns(runHistory, reportCriteria)
    if (reportScope === "merged") return runHistory.filter((run) => isRunCompatible(run, reportCriteria) !== false)
    return runHistory
  }, [reportCriteria, reportScope, runHistory])
  const mergedBatch = useMemo(() => castBatch(buildMergedBatchFromRuns(runsForScope)), [runsForScope])
  const activeBatchResponse = reportScope === "latest" ? batchResponse : mergedBatch
  const showReplicateAggregation = reportScope === "merged" || reportScope === "compatible"
  const replicateSummary = useMemo(
    () => (showReplicateAggregation ? buildReplicateSummary(runsForScope, reportCriteria) : null),
    [reportCriteria, runsForScope, showReplicateAggregation],
  )

  const rankings = useMemo(() => {
    return activeBatchResponse ? buildModelRankings(activeBatchResponse, reportCriteria) : mockRankings
  }, [activeBatchResponse, reportCriteria])
  const activeReportScoringCriteria = getScoringCriteria(reportCriteria)
  const reportOnlyCriteria = getReportOnlyCriteria(reportCriteria)
  const activeReportWeight = getActiveScoringWeight(reportCriteria)
  const bestConfiguration = rankings[0]
  const weakestCases = useMemo(() => {
    return activeBatchResponse ? buildWeakestCases(activeBatchResponse) : []
  }, [activeBatchResponse])
  const unsafeExamples = useMemo(() => {
    return activeBatchResponse ? getUnsafeRecommendationExamples(activeBatchResponse) : []
  }, [activeBatchResponse])
  const failedCalls = useMemo(() => {
    return activeBatchResponse ? getFailedCalls(activeBatchResponse) : []
  }, [activeBatchResponse])
  const rateLimitedCalls = failedCalls.filter((call) => call.failureReason === "rate_limited")
  const matchedLowCriterion = useMemo(() => {
    return activeBatchResponse ? getMatchedButLowCriterionExamples(activeBatchResponse) : []
  }, [activeBatchResponse])
  const isRealReport = Boolean(activeBatchResponse)
  const compatibleRunCount = runHistory.filter((run) => isRunCompatible(run, reportCriteria) === true).length
  const warningRunCount = runHistory.filter((run) => isRunCompatible(run, reportCriteria) !== true).length
  const uniqueCaseCount = new Set(runHistory.flatMap((run) => run.cases.map((caseResult) => String(caseResult.caseId)))).size
  const uniqueConfigCount = new Set(
    runHistory.flatMap((run) =>
      run.cases.flatMap((caseResult) =>
        Array.isArray(caseResult.results)
          ? caseResult.results.map((result) => String((result as { configId?: unknown }).configId ?? "unknown"))
          : [],
      ),
    ),
  ).size

  const refreshWorkspaceState = () => {
    const localData = readLocalWorkspaceData()
    setRunHistory(localData.benchmarkRunHistory ?? [])
    setBatchResponse((localData.latestBatchEvaluationResponse as BatchEvaluationResponse | undefined) ?? null)
    setReportCriteria(parseEvaluationCriteria(localStorage.getItem(STORAGE_KEYS.evaluationCriteria)))
  }

  const exportWorkspace = (resultsOnly = false) => {
    const localData = readLocalWorkspaceData()
    const workspace = createWorkspaceExport(
      resultsOnly
        ? {
            benchmarkRunHistory: localData.benchmarkRunHistory,
            latestBatchEvaluationResponse: localData.latestBatchEvaluationResponse,
          }
        : localData,
    )
    downloadJson(resultsOnly ? "pct-benchmark-results.json" : "pct-workspace-export.json", workspace)
    setWorkspaceMessage(resultsOnly ? "Results export created." : "Workspace export created without API keys.")
  }

  const previewWorkspaceImport = (raw: string) => {
    setCloudConflictPending(false)
    setImportText(raw)
    const workspace = parseWorkspaceExport(raw)
    const preview = buildWorkspaceImportPreview({
      workspace,
      localData: readLocalWorkspaceData(),
    })
    setImportWorkspace(workspace)
    setImportPreview(preview)
    setConflictActions(Object.fromEntries(preview.conflicts.map((conflict) => [conflict.id, conflict.defaultAction])))
    setWorkspaceMessage(preview.valid ? "Import preview ready. Review conflicts before applying." : preview.error ?? "Invalid workspace JSON.")
  }

  const applyImport = () => {
    if (!importWorkspace || !importPreview?.valid) return
    const merged = applyWorkspaceImport({
      workspace: importWorkspace,
      localData: readLocalWorkspaceData(),
      options: {
        mode: importMode,
        categories: importCategories,
        conflictActions,
      },
    })
    writeWorkspaceData(merged)
    refreshWorkspaceState()
    setWorkspaceMessage("Workspace import applied. API keys were not imported.")
    if (cloudConflictPending) {
      setCloudNotice({ kind: "success", message: "Cloud run conflict choices applied to local history." })
      setCloudConflictPending(false)
    }
  }

  const deleteRun = (batchId: string) => {
    const next = runHistory.filter((run) => run.batchId !== batchId)
    writeBenchmarkRunHistory(localStorage, next)
    setRunHistory(next)
    setWorkspaceMessage(`Deleted run ${batchId}.`)
  }

  const clearRunHistory = () => {
    writeBenchmarkRunHistory(localStorage, [])
    setRunHistory([])
    setWorkspaceMessage("Benchmark run history cleared.")
  }

  const saveSelectedRunToCloud = async () => {
    const artifact = runHistory.find((run) => run.batchId === cloudSelectedBatchId)
    if (!artifact) {
      setCloudNotice({ kind: "error", message: "Select one completed benchmark run to save." })
      return
    }

    setCloudBusy("save")
    setCloudNotice(null)
    try {
      const result = await saveBenchmarkRunToCloud(artifact)
      setLastCloudSave(result)
      setCloudRunIdInput(result.runId)
      setCloudNotice({
        kind: "success",
        message: result.created
          ? "Benchmark run saved to AWS. Keep the Cloud Run ID to retrieve it later."
          : "This benchmark run already exists in AWS under the generated Cloud Run ID.",
      })
    } catch (error) {
      setCloudNotice({ kind: "error", message: getCloudErrorMessage(error, "save") })
    } finally {
      setCloudBusy(null)
    }
  }

  const loadCloudRun = async () => {
    const runId = cloudRunIdInput.trim()
    if (!isCloudRunId(runId)) {
      setCloudNotice({ kind: "error", message: "Enter a valid Cloud Run ID." })
      return
    }

    setCloudBusy("load")
    setCloudNotice(null)
    try {
      const result = await loadBenchmarkRunFromCloud(runId)
      const workspace = createWorkspaceExport({ benchmarkRunHistory: [result.artifact] })
      const localData = readLocalWorkspaceData()
      const preview = buildWorkspaceImportPreview({ workspace, localData })

      if (!preview.valid) {
        throw new CloudBenchmarkRunError("ARTIFACT_REJECTED", "The returned benchmark artifact is invalid.")
      }
      if (preview.exactDuplicateRunCount > 0) {
        setCloudNotice({ kind: "info", message: "This run already exists locally." })
        setCloudConflictPending(false)
        return
      }
      if (preview.conflicts.length > 0) {
        setImportText("")
        setImportWorkspace(workspace)
        setImportPreview(preview)
        setImportMode("merge")
        setImportCategories({ ...CLOUD_RUN_IMPORT_CATEGORIES })
        setConflictActions(Object.fromEntries(preview.conflicts.map((conflict) => [conflict.id, conflict.defaultAction])))
        setCloudConflictPending(true)
        setCloudNotice({
          kind: "info",
          message: "The cloud run conflicts with local history. Review the existing import conflict choices and apply them explicitly.",
        })
        return
      }

      const merged = applyWorkspaceImport({
        workspace,
        localData,
        options: {
          mode: "merge",
          categories: CLOUD_RUN_IMPORT_CATEGORIES,
          conflictActions: {},
        },
      })
      writeWorkspaceData(merged)
      refreshWorkspaceState()
      setCloudConflictPending(false)
      setCloudNotice({ kind: "success", message: "Cloud run loaded successfully." })
    } catch (error) {
      setCloudConflictPending(false)
      setCloudNotice({ kind: "error", message: getCloudErrorMessage(error, "load") })
    } finally {
      setCloudBusy(null)
    }
  }

  const copyLastCloudRunId = async () => {
    if (!lastCloudSave) return
    try {
      await navigator.clipboard.writeText(lastCloudSave.runId)
      setCloudNotice({ kind: "success", message: "Cloud Run ID copied." })
    } catch {
      setCloudNotice({ kind: "error", message: "Could not copy the Cloud Run ID. Copy it manually instead." })
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar activePage="Reports" />

      <div className="flex-1 flex flex-col">
        <Header
          title="Benchmark Reports"
          description="Reports summarize benchmark alignment, safety signals, consistency, workflow traces, and limitations."
        />

        <main className="flex-1 p-6 overflow-auto">
          <Card className={`mb-6 ${isRealReport ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5"}`}>
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                {isRealReport ? (
                  <CheckCircle2 className="h-5 w-5 text-success mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-warning-foreground mt-0.5 shrink-0" />
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {isRealReport
                      ? reportScope === "latest"
                        ? "Generated from latest batch benchmark run"
                        : "Generated from merged benchmark history"
                      : "Mock report view for proposal/demo purposes."}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isRealReport
                      ? reportScope === "latest"
                        ? "This report is computed from sessionStorage.latestBatchEvaluationResponse and is not persisted on the server."
                        : "This report is computed from localStorage.benchmarkRunHistory and imported run snapshots."
                      : "Run a batch benchmark to replace these illustrative/mock values with real aggregate reporting."}
                  </p>
                  {isRealReport ? (
                    <p className="text-xs text-muted-foreground mt-1">
                      Single-case execution results are not included in aggregate benchmark reports unless the case is saved to the case library and selected in a batch benchmark.
                    </p>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Workspace Sharing</CardTitle>
              </div>
              <CardDescription>
                Export, import, and merge local benchmark workspaces without a database
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-sm font-medium text-foreground">Safety note</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Workspace export does not include API keys. Each user must enter their own provider key.
                </p>
              </div>

              {cloudPersistenceEnabled ? (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4" data-testid="cloud-persistence">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <Cloud className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Cloud Persistence</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Explicitly save one completed run to AWS or retrieve one by its Cloud Run ID.
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline">Optional prototype</Badge>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <div>
                      <label className="text-xs font-medium text-foreground" htmlFor="cloud-run-selection">
                        Local completed run
                      </label>
                      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                        <select
                          id="cloud-run-selection"
                          value={cloudSelectedBatchId}
                          onChange={(event) => setCloudSelectedBatchId(event.target.value)}
                          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                          disabled={cloudBusy !== null}
                        >
                          <option value="">Select a run...</option>
                          {runHistory.map((run) => (
                            <option key={run.batchId} value={run.batchId}>
                              {run.batchId} ({run.cases.length} cases)
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          size="sm"
                          onClick={saveSelectedRunToCloud}
                          disabled={!cloudSelectedBatchId || cloudBusy !== null}
                        >
                          {cloudBusy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                          Save Run to AWS
                        </Button>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-foreground" htmlFor="cloud-run-id">
                        Cloud Run ID
                      </label>
                      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                        <input
                          id="cloud-run-id"
                          type="text"
                          value={cloudRunIdInput}
                          onChange={(event) => setCloudRunIdInput(event.target.value)}
                          placeholder="00000000-0000-4000-8000-000000000000"
                          autoComplete="off"
                          spellCheck={false}
                          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-xs"
                          disabled={cloudBusy !== null}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={loadCloudRun}
                          disabled={cloudBusy !== null}
                        >
                          {cloudBusy === "load" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                          Load Cloud Run
                        </Button>
                      </div>
                    </div>
                  </div>

                  {lastCloudSave ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/70 p-2 text-xs">
                      <span className="text-muted-foreground">Last Cloud Run ID:</span>
                      <code className="break-all text-foreground">{lastCloudSave.runId}</code>
                      <Button type="button" variant="ghost" size="sm" onClick={copyLastCloudRunId} className="h-7 px-2">
                        <Copy className="mr-1 h-3.5 w-3.5" />
                        Copy
                      </Button>
                      <span className="text-muted-foreground">{lastCloudSave.artifactByteSize.toLocaleString()} bytes</span>
                    </div>
                  ) : null}

                  {cloudNotice ? (
                    <p
                      role="status"
                      className={`mt-3 text-xs ${
                        cloudNotice.kind === "error"
                          ? "text-destructive"
                          : cloudNotice.kind === "success"
                            ? "text-success"
                            : "text-muted-foreground"
                      }`}
                    >
                      {cloudNotice.message}
                    </p>
                  ) : null}

                  <p className="mt-3 text-xs text-warning-foreground">
                    Prototype cloud persistence. Stored benchmark artifacts must contain synthetic/non-sensitive data. This demo API
                    is not authenticated and is not intended for production or PHI.
                  </p>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <MetricCard label="Run History" value={String(runHistory.length)} icon={<FileText className="h-5 w-5 text-primary" />} />
                <MetricCard label="Unique Cases" value={String(uniqueCaseCount)} icon={<Target className="h-5 w-5 text-primary" />} />
                <MetricCard label="Unique Configs" value={String(uniqueConfigCount)} icon={<Brain className="h-5 w-5 text-primary" />} />
                <MetricCard label="Compatibility Warnings" value={String(warningRunCount)} icon={<AlertTriangle className="h-5 w-5 text-warning" />} />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-foreground" htmlFor="report-scope">
                      Report Scope
                    </label>
                    <select
                      id="report-scope"
                      value={reportScope}
                      onChange={(event) => setReportScope(event.target.value as ReportScope)}
                      className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="latest">Latest batch run</option>
                      <option value="merged">Merged benchmark history</option>
                      <option value="compatible">Compatible runs only</option>
                      <option value="all">All imported runs</option>
                    </select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Compatible runs: {compatibleRunCount}. Compatibility unknown or warning: {warningRunCount}.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => exportWorkspace(false)}>
                      <Download className="mr-2 h-4 w-4" />
                      Export full workspace
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => exportWorkspace(true)}>
                      <Download className="mr-2 h-4 w-4" />
                      Export only results
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={clearRunHistory} disabled={runHistory.length === 0}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Clear imported run history
                    </Button>
                  </div>

                  {runHistory.length > 0 ? (
                    <div className="max-h-48 space-y-2 overflow-auto rounded-lg border border-border p-2">
                      {runHistory.map((run) => {
                        const compatibility = isRunCompatible(run, reportCriteria)
                        return (
                          <div key={run.batchId} className="flex items-start justify-between gap-3 rounded-md bg-muted/30 p-2">
                            <div>
                              <p className="text-sm font-medium text-foreground">{run.batchId}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatDate(run.createdAt)} | {run.cases.length} case rows |{" "}
                                {compatibility === true
                                  ? "Compatible"
                                  : compatibility === false
                                    ? "Compatibility warning"
                                    : "Compatibility unknown"}
                              </p>
                            </div>
                            <Button type="button" variant="outline" size="sm" onClick={() => deleteRun(run.batchId)}>
                              Delete
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={importMode === "merge" ? "secondary" : "outline"}>Merge preserves local items</Badge>
                    <Badge variant={importMode === "replace" ? "secondary" : "outline"}>Replace selected categories</Badge>
                  </div>
                  <select
                    value={importMode}
                    onChange={(event) => setImportMode(event.target.value as WorkspaceMergeMode)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="merge">Merge mode</option>
                    <option value="replace">Replace selected categories</option>
                  </select>
                  <textarea
                    value={importText}
                    onChange={(event) => previewWorkspaceImport(event.target.value)}
                    placeholder="Paste workspace JSON here..."
                    className="min-h-28 w-full rounded-md border border-input bg-background p-3 text-sm"
                  />
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={async (event) => {
                      const file = event.target.files?.[0]
                      if (!file) return
                      previewWorkspaceImport(await file.text())
                    }}
                    className="text-sm"
                  />

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {WORKSPACE_CATEGORIES.map((category) => (
                      <label key={category.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={importCategories[category.id]}
                          onChange={(event) =>
                            setImportCategories((current) => ({ ...current, [category.id]: event.target.checked }))
                          }
                        />
                        {category.label}
                      </label>
                    ))}
                  </div>

                  {importPreview ? (
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-sm font-medium text-foreground">
                        {importPreview.valid ? "Import preview" : "Invalid import"}
                      </p>
                      {importPreview.error ? <p className="mt-1 text-xs text-destructive">{importPreview.error}</p> : null}
                      {importPreview.valid ? (
                        <>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                            {WORKSPACE_CATEGORIES.map((category) => (
                              <p key={category.id}>
                                {category.label}: {importPreview.counts[category.id]}
                              </p>
                            ))}
                          </div>
                          {importPreview.apiKeysDetected ? (
                            <p className="mt-2 text-xs text-warning-foreground">
                              Possible API key fields were detected and will be ignored.
                            </p>
                          ) : null}
                          {importPreview.exactDuplicateRunCount > 0 ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Exact duplicate runs detected by content hash: {importPreview.exactDuplicateRunCount}. These will be skipped.
                            </p>
                          ) : null}
                          {importPreview.conflicts.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              <p className="text-xs font-medium text-foreground">Conflicts</p>
                              {importPreview.conflicts.map((conflict) => (
                                <div key={conflict.id} className="rounded-md bg-muted/40 p-2">
                                  <p className="text-xs font-medium text-foreground">
                                    {conflict.itemType}: {conflict.itemName}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {conflict.summary}
                                    {conflict.mineUpdatedAt ? ` Mine: ${formatDate(conflict.mineUpdatedAt)}.` : ""}
                                    {conflict.importedUpdatedAt ? ` Imported: ${formatDate(conflict.importedUpdatedAt)}.` : ""}
                                  </p>
                                  <select
                                    value={conflictActions[conflict.id] ?? conflict.defaultAction}
                                    onChange={(event) =>
                                      setConflictActions((current) => ({
                                        ...current,
                                        [conflict.id]: event.target.value as WorkspaceConflictAction,
                                      }))
                                    }
                                    className="mt-2 h-8 rounded-md border border-input bg-background px-2 text-xs"
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
                            <p className="mt-2 text-xs text-muted-foreground">No conflicts detected. New items will be added after confirmation.</p>
                          )}
                          <Button type="button" className="mt-3" size="sm" onClick={applyImport}>
                            Apply import
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              {workspaceMessage ? <p className="text-xs text-muted-foreground">{workspaceMessage}</p> : null}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-muted-foreground">
                Report Generated: {isRealReport ? formatDate(activeBatchResponse?.createdAt) : "Demo"}
              </Badge>
              <Badge variant="outline" className="text-muted-foreground">
                {isRealReport ? `${activeBatchResponse?.caseCount ?? 0} Cases Evaluated` : "48 Cases Evaluated (Mock)"}
              </Badge>
              <Badge variant="outline" className="text-muted-foreground">
                {isRealReport
                  ? `${activeBatchResponse?.totalConfigCount ?? activeBatchResponse?.configCount ?? activeBatchResponse?.modelCount ?? 0} Configurations Tested`
                  : "3 Configurations Tested (Mock)"}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled>
                <FileText className="h-4 w-4 mr-2" />
                Export PDF
              </Button>
              <Button variant="outline" size="sm" disabled>
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
              <Button size="sm" disabled>
                <Save className="h-4 w-4 mr-2" />
                Save Report
              </Button>
            </div>
          </div>

          <Card className="mb-6 border-l-4 border-l-primary">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Executive Summary</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {isRealReport ? (
                <>
                  <p className="text-foreground leading-relaxed">
                    Batch <span className="font-medium">{activeBatchResponse?.batchId}</span> evaluated{" "}
                    <span className="font-medium">{activeBatchResponse?.caseCount}</span> cases across{" "}
                    <span className="font-medium">
                      {activeBatchResponse?.totalConfigCount ?? activeBatchResponse?.configCount ?? activeBatchResponse?.modelCount}
                    </span>{" "}
                    benchmark configurations using{" "}
                    <span className="font-medium">{activeBatchResponse?.providerId}</span>.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2">
                    <MetricCard label="Recommendation Match" value={formatScore(activeBatchResponse?.aggregate.averageRecommendationMatch)} icon={<Target className="h-5 w-5 text-primary" />} />
                    <MetricCard label="Criterion Alignment" value={formatScore(activeBatchResponse?.aggregate.averageCriterionAlignment)} icon={<TrendingUp className="h-5 w-5 text-primary" />} />
                    <MetricCard label="Safety Score" value={formatScore(activeBatchResponse?.aggregate.averageSafety)} icon={<Shield className="h-5 w-5 text-success" />} />
                    <MetricCard label="Explainability" value={formatScore(activeBatchResponse?.aggregate.averageExplainability)} icon={<Brain className="h-5 w-5 text-accent" />} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <MetricCard label="Failed Model Calls" value={String(activeBatchResponse?.aggregate.failedModelCalls ?? 0)} icon={<XCircle className="h-5 w-5 text-destructive" />} />
                    <MetricCard label="Unsafe / Caution Findings" value={String(activeBatchResponse?.aggregate.totalSafetyWarnings ?? 0)} icon={<AlertTriangle className="h-5 w-5 text-warning" />} />
                  </div>
                </>
              ) : (
                <p className="text-foreground leading-relaxed">
                  This is an illustrative/mock executive summary for proposal/demo purposes. Run a batch benchmark to generate provider, case, model, and score metrics from real results.
                </p>
              )}
            </CardContent>
          </Card>

          {replicateSummary ? (
            <Card className="mb-6">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">Merged History Stability</CardTitle>
                </div>
                <CardDescription>
                  Replicate aggregation across repeated case/config evaluations
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-sm text-muted-foreground">
                    Repeated evaluations are treated as replicate observations. Consistency measures how often the same
                    configuration gives the same recommendation for the same case across runs. This is not the same as
                    clinical confidence.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <MetricCard label="Total Runs" value={String(replicateSummary.totalRuns)} icon={<FileText className="h-5 w-5 text-primary" />} />
                  <MetricCard label="Observations" value={String(replicateSummary.totalObservations)} icon={<Target className="h-5 w-5 text-primary" />} />
                  <MetricCard label="Case/Config Pairs" value={String(replicateSummary.uniqueCaseConfigPairs)} icon={<Brain className="h-5 w-5 text-primary" />} />
                  <MetricCard label="Replicated Pairs" value={String(replicateSummary.replicatedPairs)} icon={<TrendingUp className="h-5 w-5 text-primary" />} />
                  <MetricCard label="Avg Replicates/Pair" value={formatNumber(replicateSummary.averageReplicatesPerPair)} icon={<Info className="h-5 w-5 text-primary" />} />
                  <MetricCard label="Avg Consistency" value={formatScore(replicateSummary.averageRecommendationConsistency)} icon={<CheckCircle2 className="h-5 w-5 text-success" />} />
                </div>

                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[920px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Config</th>
                        <th className="px-3 py-2 font-medium">Mean Weighted</th>
                        <th className="px-3 py-2 font-medium">Observations</th>
                        <th className="px-3 py-2 font-medium">Unique Cases</th>
                        <th className="px-3 py-2 font-medium">Avg Rep/case</th>
                        <th className="px-3 py-2 font-medium">Consistency</th>
                        <th className="px-3 py-2 font-medium">Failure Rate</th>
                        <th className="px-3 py-2 font-medium">Unsafe Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {replicateSummary.configs.map((config) => (
                        <tr key={config.configKey} className="border-b border-border last:border-b-0">
                          <td className="px-3 py-2">
                            <p className="font-medium text-foreground">{config.label}</p>
                            <p className="text-xs text-muted-foreground">{config.configType}</p>
                          </td>
                          <td className="px-3 py-2">
                            {formatScore(config.meanWeightedScore)}
                            {config.scoreStdDev !== null ? (
                              <span className="block text-xs text-muted-foreground">
                                SD {formatNumber(config.scoreStdDev)}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">{config.observationCount}</td>
                          <td className="px-3 py-2">{config.uniqueCaseCount}</td>
                          <td className="px-3 py-2">{formatNumber(config.averageReplicatesPerCase)}</td>
                          <td className="px-3 py-2">{formatScore(config.recommendationConsistencyMean)}</td>
                          <td className="px-3 py-2">{formatRate(config.failedCallRate)}</td>
                          <td className="px-3 py-2">{formatRate(config.unsafeOutputRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-3">
                  {replicateSummary.configs
                    .filter((config) => config.replicatedPairs.length > 0)
                    .map((config) => (
                      <div key={`${config.configKey}-replicates`} className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">{config.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {config.replicatedPairs.length} replicated case/config pairs
                            </p>
                          </div>
                          <Badge variant="outline">Consistency {formatScore(config.recommendationConsistencyMean)}</Badge>
                        </div>
                        <div className="mt-3 space-y-2">
                          {config.replicatedPairs.slice(0, 6).map((pair) => (
                            <div key={pair.pairKey} className="rounded-md bg-muted/30 p-2">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-medium text-foreground">{pair.caseTitle}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {pair.runCount} runs | majority {pair.majorityRecommendation} ({pair.majorityRecommendationCount})
                                  </p>
                                </div>
                                <Badge variant="secondary">
                                  {(pair.recommendationConsistencyRate * 100).toFixed(1)}% consistent
                                </Badge>
                              </div>
                              <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-muted-foreground md:grid-cols-2">
                                <p>Recommendations: {formatDistribution(pair.recommendationDistribution, pair.runCount)}</p>
                                <p>Confidence: {formatDistribution(pair.confidenceDistribution, pair.runCount)}</p>
                                <p>
                                  Mean score: {formatScore(pair.meanWeightedScore)} | Range{" "}
                                  {formatScore(pair.minWeightedScore)} - {formatScore(pair.maxWeightedScore)}
                                </p>
                                <p>
                                  Failed runs: {pair.failedRunCount} | Unsafe warnings: {pair.unsafeWarningCount}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {isRealReport ? (
            <Card className="mb-6">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Info className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">Evaluation Rubric Used</CardTitle>
                </div>
                <CardDescription>
                  Criteria settings captured from the latest batch benchmark run
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Scores are based on deterministic PCT reference logic and rule-based output checks. This benchmark measures alignment with the provided reference logic, not real-world clinical superiority.
                </p>
                <div>
                  <p className="text-sm font-medium text-foreground">Numeric criteria</p>
                  <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {activeReportScoringCriteria.map((criterion) => (
                      <div key={criterion.id} className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">{criterion.name}</p>
                          <Badge variant="secondary">Weight {criterion.weight}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {criterion.shortDescription || criterion.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Report-only criteria</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {reportOnlyCriteria.length > 0 ? (
                      reportOnlyCriteria.map((criterion) => (
                        <Badge key={criterion.id} variant="outline">
                          {criterion.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">No report-only criteria enabled.</span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Report-only criteria do not affect numeric ranking unless a scoring method is implemented.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Workflow / Configuration Ranking</CardTitle>
              </div>
              <CardDescription>
                {isRealReport
                  ? "Weighted score uses the active scoring criteria configured in Evaluation Setup. Weights are normalized during ranking."
                  : "Mock/demo ranking shown until a batch result is available"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isRealReport ? (
                <div className="mb-4 rounded-lg border border-border p-3">
                  <p className="text-sm font-medium text-foreground">Criteria used</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Active scoring weight: {activeReportWeight}. Active scoring weights are normalized during ranking.
                    Report-only criteria do not affect numeric ranking.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeReportScoringCriteria.map((criterion) => (
                      <Badge key={criterion.id} variant="secondary">
                        {criterion.name}: {criterion.weight}
                      </Badge>
                    ))}
                    {reportOnlyCriteria.map((criterion) => (
                      <Badge key={criterion.id} variant="outline">
                        Report-only: {criterion.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="space-y-4">
                {rankings.map((config, index) => (
                  <div
                    key={config.configId}
                    className={`p-4 rounded-lg border ${index === 0 ? "bg-success/5 border-success/30" : "bg-card"}`}
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${index === 0 ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"}`}>
                          {index + 1}
                        </div>
                        <div>
                          <h4 className="font-semibold">{config.configLabel ?? config.modelLabel}</h4>
                          <p className="text-sm text-muted-foreground">{config.configId}</p>
                          <p className="text-xs text-muted-foreground">
                            {config.casesEvaluated} cases evaluated | {config.failedCalls} failed calls
                          </p>
                          {config.configType ? (
                            <Badge variant="secondary" className="mt-2">
                              {config.configType === "workflow" ? "Workflow" : "Model-only"}
                            </Badge>
                          ) : null}
                          {config.workflowType ? (
                            <Badge variant="outline" className="mt-2 ml-2">
                              {config.workflowType}
                            </Badge>
                          ) : null}
                          {config.workflowStepCount ? (
                            <Badge variant="outline" className="mt-2 ml-2">
                              {config.workflowStepCount} steps
                            </Badge>
                          ) : null}
                          {config.toolAssisted ? (
                            <Badge variant="secondary" className="mt-2 ml-2">
                              Tool-assisted
                            </Badge>
                          ) : null}
                          {config.configType === "workflow" ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Workflow execution trace available in Benchmark Results. Final scoring uses the final workflow step output.
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="md:text-right">
                        <div className="text-2xl font-bold">{config.weightedScore.toFixed(1)}%</div>
                        <Badge variant={index === 0 ? "secondary" : "outline"}>{index === 0 ? "Best ranked" : "Ranked"}</Badge>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <ScoreBar score={config.averageRecommendationMatch} label="Recommendation Match" />
                      <ScoreBar score={config.averageCriterionAlignment} label="Criterion Alignment" />
                      <ScoreBar score={config.averageSafety} label="Safety" />
                      <ScoreBar score={config.averageExplainability} label="Explainability" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Best Performing Configuration</CardTitle>
                <CardDescription>Highest weighted score in this report</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {bestConfiguration ? (
                  <>
                    <div className="flex items-center gap-4 p-4 bg-card rounded-lg border">
                      <div className="w-12 h-12 rounded-full bg-success flex items-center justify-center">
                        <CheckCircle2 className="h-6 w-6 text-success-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-lg">{bestConfiguration.configLabel ?? bestConfiguration.modelLabel}</h4>
                        <p className="text-sm text-muted-foreground break-all">{bestConfiguration.configId}</p>
                        {bestConfiguration.configType ? (
                          <Badge variant="secondary" className="mt-2">
                            {bestConfiguration.configType === "workflow" ? "Workflow" : "Model-only"}
                          </Badge>
                        ) : null}
                        {bestConfiguration.workflowType ? (
                          <Badge variant="outline" className="mt-2 ml-2">
                            {bestConfiguration.workflowType}
                          </Badge>
                        ) : null}
                        {bestConfiguration.workflowStepCount ? (
                          <Badge variant="outline" className="mt-2 ml-2">
                            {bestConfiguration.workflowStepCount} steps
                          </Badge>
                        ) : null}
                        {bestConfiguration.toolAssisted ? (
                          <Badge variant="secondary" className="mt-2 ml-2">
                            Tool-assisted
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-success">{bestConfiguration.weightedScore.toFixed(1)}%</div>
                        <p className="text-xs text-muted-foreground">Weighted</p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      This configuration led the run based on final recommendation accuracy, criterion-level logic, safety, and explainability.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No successful configuration scores are available.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Weakest Cases</CardTitle>
                <CardDescription>Lowest average criterion alignment</CardDescription>
              </CardHeader>
              <CardContent>
                {isRealReport && weakestCases.length > 0 ? (
                  <div className="space-y-3">
                    {weakestCases.map((caseResult) => (
                      <div key={caseResult.caseId} className="rounded-lg border border-border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">{caseResult.title}</p>
                            <p className="text-xs text-muted-foreground">Expected: {caseResult.expectedReferenceLabel}</p>
                          </div>
                          <Badge variant="outline">{formatScore(caseResult.averageCriterionAlignment)}</Badge>
                        </div>
                        {caseResult.failedCalls > 0 ? (
                          <p className="text-xs text-muted-foreground mt-2">{caseResult.failedCalls} failed model calls</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {isRealReport ? "No case-level scores are available." : "Weakest-case analysis will appear after a batch benchmark run."}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mb-6 border-destructive/30">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertOctagon className="h-5 w-5 text-destructive" />
                <CardTitle className="text-lg">Safety / Limitation Findings</CardTitle>
              </div>
              <CardDescription>
                {isRealReport ? "Findings computed from the latest batch result" : "Mock/demo limitation section"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isRealReport ? (
                <>
                  <div className="flex items-start gap-3 p-4 bg-background rounded-lg border border-border">
                    <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Unsafe recommendation examples are cases where the model recommended discontinuation or failed to require clinical review while the reference logic required continuing antibiotics, insufficient information handling, or clinical review.
                    </p>
                  </div>
                  <FindingBlock
                    title="Unsafe recommendation examples"
                    count={unsafeExamples.length}
                    emptyText="No unsafe discontinuation examples were detected."
                    items={unsafeExamples.slice(0, 5).map((item) => ({
                      configId: item.configId,
                      caseId: item.caseId,
                      type: item.type,
                      text: `${item.modelLabel} on ${item.caseTitle}; reference was ${item.reference}`,
                    }))}
                  />
                  <FindingBlock
                    title="Failed model calls"
                    count={failedCalls.length}
                    emptyText="No failed model calls were recorded."
                    items={failedCalls.slice(0, 5).map((item) => ({
                      configId: item.configId,
                      caseId: item.caseId,
                      type: `${item.type}-${item.failureReason}`,
                      text: `${item.modelLabel} on ${item.caseTitle}: ${item.failureReason}`,
                    }))}
                  />
                  <FindingBlock
                    title="Rate-limited calls"
                    count={rateLimitedCalls.length}
                    emptyText="No rate-limited calls were recorded."
                    items={rateLimitedCalls.slice(0, 5).map((item) => ({
                      configId: item.configId,
                      caseId: item.caseId,
                      type: `${item.type}-rate_limited`,
                      text: `${item.modelLabel} on ${item.caseTitle}`,
                    }))}
                  />
                  <FindingBlock
                    title="Final recommendation matched but criterion alignment was low"
                    count={matchedLowCriterion.length}
                    emptyText="No low-criterion-alignment matches were detected."
                    items={matchedLowCriterion.slice(0, 5).map((item) => ({
                      configId: item.configId,
                      caseId: item.caseId,
                      type: item.type,
                      text: `${item.modelLabel} on ${item.caseTitle}: ${formatScore(item.alignment)}`,
                    }))}
                  />
                </>
              ) : (
                <div className="flex items-start gap-3 p-4 bg-background rounded-lg border border-warning/30">
                  <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    Mock safety and limitation patterns are hidden until a real batch run exists, so this page does not imply measured claims.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Info className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Methodology & Limitations</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                  Reference standard: deterministic PCT rule proxy derived from B.R.A.H.M.S/PCT stewardship logic.
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                  This benchmark measures alignment with the provided rule logic, not real-world clinical superiority.
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                  Thermo Fisher adapted cases are used for realism but are not complete clinical gold-standard patient records; no affiliation or endorsement is implied.
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                  Clinical deployment would require expert validation, regulatory review, and integration with local guidelines.
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-2 border-primary/30 bg-primary/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Final Suitability Recommendation</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-background rounded-lg border">
                <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {isRealReport && bestConfiguration
                    ? `Based on this benchmark run, ${bestConfiguration.configLabel ?? bestConfiguration.modelLabel} is the most suitable configuration under the tested PCT reference logic. However, clinical use would require validation, clinician oversight, and stronger handling of edge cases.`
                    : "This section demonstrates the intended report format. Real recommendations will be generated from batch evaluation results."}
                </p>
              </div>

              {bestConfiguration ? (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <ScoreBar score={bestConfiguration.averageRecommendationMatch} label="Recommendation Match" />
                  <ScoreBar score={bestConfiguration.averageCriterionAlignment} label="Criterion Alignment" />
                  <ScoreBar score={bestConfiguration.averageSafety} label="Safety" />
                  <ScoreBar score={bestConfiguration.averageExplainability} label="Explainability" />
                </div>
              ) : null}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-3 bg-card rounded-lg border border-border">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-2xl font-bold text-foreground">{value}</p>
      </div>
    </div>
  )
}

function FindingBlock({
  title,
  count,
  emptyText,
  items,
}: {
  title: string
  count: number
  emptyText: string
  items: Array<string | FindingItem>
}) {
  const getFindingText = (item: string | FindingItem) => (typeof item === "string" ? item : item.text)
  const getFindingKey = (item: string | FindingItem, index: number) => {
    if (typeof item === "string") return `${title}-${index}`
    return `${item.id ?? item.configId ?? "config"}-${item.caseId ?? "case"}-${item.type ?? "finding"}-${index}`
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="font-medium text-sm">{title}</p>
        <Badge variant={count > 0 ? "outline" : "secondary"}>{count}</Badge>
      </div>
      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li key={getFindingKey(item, index)} className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
              {getFindingText(item)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  )
}
