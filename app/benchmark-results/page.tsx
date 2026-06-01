"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import { Sidebar } from "@/components/dashboard/sidebar"
import { Header } from "@/components/dashboard/header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { EvaluationResponse, LlmEvaluationResult } from "@/lib/types"
import { 
  Target, 
  Lightbulb, 
  AlertTriangle,
  CheckCircle2,
  Info
} from "lucide-react"

const MODEL_FAILURE_MESSAGE =
  "This model failed or is unavailable. Refresh models or choose another model in Evaluation Setup."

type BatchEvaluationResponse = {
  batchId: string
  createdAt: string
  providerId: "openrouter" | "groq"
  caseCount: number
  modelCount: number
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
  aggregate: {
    averageRecommendationMatch: number | null
    averageCriterionAlignment: number | null
    averageSafety: number | null
    averageExplainability: number | null
    totalSafetyWarnings: number
    failedModelCalls: number
  }
}

type ModelAggregate = {
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
  failedCalls: number
}

function getSafetyWarningCount(results: LlmEvaluationResult[]): number {
  return results.reduce((sum, result) => {
    const warnings = result.parsedOutput?.safety_warnings ?? []
    return sum + warnings.length
  }, 0)
}

function averageScore(
  results: LlmEvaluationResult[],
  selector: (scores: NonNullable<LlmEvaluationResult["scores"]>) => number,
): number | null {
  const scored = results.filter((result): result is LlmEvaluationResult & { scores: NonNullable<LlmEvaluationResult["scores"]> } => {
    return result.status === "success" && !!result.scores
  })

  if (scored.length === 0) return null

  const total = scored.reduce((sum, result) => sum + selector(result.scores), 0)
  return total / scored.length
}

function averageNumbers(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function formatScore(value: number | null | undefined): string {
  return value === null || value === undefined ? "N/A" : `${value.toFixed(1)}%`
}

function isRateLimitedResult(result: LlmEvaluationResult): boolean {
  return result.failureReason === "rate_limited" || Boolean(result.error?.toLowerCase().includes("rate limit"))
}

function formatBatchModelError(result: LlmEvaluationResult): string {
  if (isRateLimitedResult(result)) {
    return "Rate limited — rerun with fewer cases/models or higher delay."
  }

  return result.error || "Unknown error"
}

function getBatchModelAggregates(batchResponse: BatchEvaluationResponse): ModelAggregate[] {
  const allResults = batchResponse.cases.flatMap((caseResult) => caseResult.results)
  const configIds = Array.from(new Set(allResults.map((result) => result.configId)))

  return configIds.map((configId) => {
    const modelResults = allResults.filter((result) => result.configId === configId)
    const scored = modelResults.filter((result) => result.status === "success" && result.scores)

    return {
      configId,
      modelLabel: modelResults[0]?.modelLabel ?? configId,
      configLabel: modelResults[0]?.configLabel,
      configType: modelResults[0]?.configType,
      workflowType: modelResults[0]?.workflowType,
      workflowName: modelResults[0]?.workflowName,
      workflowStepCount: modelResults[0]?.workflowStepCount,
      toolAssisted: modelResults[0]?.toolAssisted,
      averageRecommendationMatch: averageNumbers(scored.map((result) => result.scores?.recommendationMatch ?? 0)),
      averageCriterionAlignment: averageNumbers(scored.map((result) => result.scores?.alignment ?? 0)),
      averageSafety: averageNumbers(scored.map((result) => result.scores?.safety ?? 0)),
      averageExplainability: averageNumbers(scored.map((result) => result.scores?.explainability ?? 0)),
      failedCalls: modelResults.filter((result) => result.status === "error").length,
    }
  })
}

function getMajorMismatches(
  result: LlmEvaluationResult,
  referenceChecks: NonNullable<EvaluationResponse["referenceChecks"]>,
  referenceDecision: EvaluationResponse["referenceDecision"],
): string[] {
  if (!result.parsedOutput) return []

  const mismatches: string[] = []
  if (getBooleanMatch(result.parsedOutput.absolute_threshold_met, referenceChecks.absoluteThresholdMet) === false) {
    mismatches.push("absolute threshold")
  }
  if (getBooleanMatch(result.parsedOutput.pct_decline_threshold_met, referenceChecks.pctDeclineCriterionMet) === false) {
    mismatches.push("PCT decline criterion")
  }
  if (getBooleanMatch(result.parsedOutput.clinical_improvement_present, referenceChecks.clinicalImprovementPresent) === false) {
    mismatches.push("clinical improvement")
  }
  if (getBooleanMatch(result.parsedOutput.exclusion_condition_present, referenceChecks.exclusionConditionPresent) === false) {
    mismatches.push("exclusion")
  }
  if (getBooleanMatch(result.parsedOutput.safety_gate_passed, referenceChecks.discontinuationGatePassed) === false) {
    mismatches.push("discontinuation gate")
  }
  if (
    getNumberMatch(
      result.parsedOutput.calculation_audit?.pct_decline_percent,
      referenceDecision.pctDeclinePercent,
      5,
    ) === false
  ) {
    mismatches.push("PCT decline calculation")
  }

  return mismatches
}

function averageRecommendationMatch(
  results: LlmEvaluationResult[],
  referenceRecommendation: EvaluationResponse["referenceDecision"]["recommendation"] | undefined,
): number | null {
  const successful = results.filter((result) => result.status === "success" && result.parsedOutput)
  if (successful.length === 0) return null

  const total = successful.reduce((sum, result) => {
    if (typeof result.scores?.recommendationMatch === "number") {
      return sum + result.scores.recommendationMatch
    }

    return sum + (result.parsedOutput?.recommendation === referenceRecommendation ? 100 : 0)
  }, 0)

  return total / successful.length
}

function formatNullableBoolean(value: boolean | null | undefined): string {
  if (value === true) return "Yes"
  if (value === false) return "No"
  return "N/A"
}

function formatNullableNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "N/A" : String(value)
}

function formatNullablePercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "N/A" : `${value.toFixed(1)}%`
}

function getRecommendationMatch(
  result: LlmEvaluationResult,
  referenceRecommendation: EvaluationResponse["referenceDecision"]["recommendation"],
): number | null {
  if (typeof result.scores?.recommendationMatch === "number") return result.scores.recommendationMatch
  if (!result.parsedOutput) return null
  return result.parsedOutput.recommendation === referenceRecommendation ? 100 : 0
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

function formatStatus(match: boolean | null): string {
  if (match === null) return "Not comparable"
  return match ? "Match" : "Mismatch"
}

function getStatusClass(match: boolean | null): string {
  if (match === null) return "text-muted-foreground"
  return match ? "text-success" : "text-destructive"
}

export default function BenchmarkResultsPage() {
  const [evaluationResponse, setEvaluationResponse] = useState<EvaluationResponse | null>(null)
  const [batchResponse, setBatchResponse] = useState<BatchEvaluationResponse | null>(null)

  useEffect(() => {
    try {
      const storedBatch = sessionStorage.getItem("latestBatchEvaluationResponse")
      if (storedBatch) {
        const parsedBatch = JSON.parse(storedBatch) as BatchEvaluationResponse
        setBatchResponse(parsedBatch)
        return
      }

      const stored = sessionStorage.getItem("latestEvaluationResponse")
      if (!stored) return
      const parsed = JSON.parse(stored) as EvaluationResponse
      setEvaluationResponse(parsed)
    } catch {
      // Ignore invalid session storage payloads.
    }
  }, [])

  const results = evaluationResponse?.results ?? []
  const batchModelAggregates = useMemo(() => {
    return batchResponse ? getBatchModelAggregates(batchResponse) : []
  }, [batchResponse])

  const averages = useMemo(() => {
    return {
      recommendationMatch: averageRecommendationMatch(results, evaluationResponse?.referenceDecision.recommendation),
      alignment: averageScore(results, (scores) => scores.alignment),
      safety: averageScore(results, (scores) => scores.safety),
      explainability: averageScore(results, (scores) => scores.explainability),
      safetyWarnings: getSafetyWarningCount(results),
    }
  }, [results, evaluationResponse?.referenceDecision.recommendation])

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar activePage="Benchmark Results" />
      
      <div className="flex-1 flex flex-col">
        <Header 
          title="Benchmark Results" 
          description="Comparative analysis of LLM configurations for PCT-guided stewardship"
        />
        
        <main className="flex-1 p-6 overflow-auto">
          {batchResponse ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4 mb-6">
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm font-medium text-muted-foreground">Recommendation Match</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatScore(batchResponse.aggregate.averageRecommendationMatch)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm font-medium text-muted-foreground">Criterion Alignment</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatScore(batchResponse.aggregate.averageCriterionAlignment)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm font-medium text-muted-foreground">Explainability</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatScore(batchResponse.aggregate.averageExplainability)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm font-medium text-muted-foreground">Safety Score</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatScore(batchResponse.aggregate.averageSafety)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm font-medium text-muted-foreground">Failed Model Calls</p>
                    <p className="text-2xl font-bold text-foreground">{batchResponse.aggregate.failedModelCalls}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm font-medium text-muted-foreground">Safety Warnings</p>
                    <p className="text-2xl font-bold text-foreground">{batchResponse.aggregate.totalSafetyWarnings}</p>
                  </CardContent>
                </Card>
              </div>

              <p className="text-sm text-muted-foreground mb-6">
                Batch {batchResponse.batchId} | {batchResponse.caseCount} cases | {batchResponse.modelCount} workflow/configs
              </p>

              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="text-base">Configuration-Level Aggregates</CardTitle>
                  <CardDescription>Average scores across selected benchmark cases</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Workflow / config</th>
                        <th className="py-2 pr-4 font-medium">Recommendation</th>
                        <th className="py-2 pr-4 font-medium">Criterion</th>
                        <th className="py-2 pr-4 font-medium">Safety</th>
                        <th className="py-2 pr-4 font-medium">Explainability</th>
                        <th className="py-2 pr-4 font-medium">Failed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchModelAggregates.map((model) => (
                        <tr key={model.configId} className="border-b border-border/60">
                          <td className="py-3 pr-4">
                            <p className="font-medium text-foreground">{model.configLabel ?? model.modelLabel}</p>
                            <p className="text-xs text-muted-foreground">{model.configId}</p>
                            {model.configType ? (
                              <Badge variant="secondary" className="mt-1 text-xs">
                                {model.configType === "workflow" ? "Workflow" : "Model-only"}
                              </Badge>
                            ) : null}
                            {model.workflowType ? (
                              <Badge variant="outline" className="mt-1 ml-1 text-xs">
                                {model.workflowType}
                              </Badge>
                            ) : null}
                            {model.workflowStepCount ? (
                              <Badge variant="outline" className="mt-1 ml-1 text-xs">
                                {model.workflowStepCount} steps
                              </Badge>
                            ) : null}
                            {model.toolAssisted ? (
                              <Badge variant="secondary" className="mt-1 ml-1 text-xs">
                                Tool-assisted
                              </Badge>
                            ) : null}
                          </td>
                          <td className="py-3 pr-4">{formatScore(model.averageRecommendationMatch)}</td>
                          <td className="py-3 pr-4">{formatScore(model.averageCriterionAlignment)}</td>
                          <td className="py-3 pr-4">{formatScore(model.averageSafety)}</td>
                          <td className="py-3 pr-4">{formatScore(model.averageExplainability)}</td>
                          <td className="py-3 pr-4">{model.failedCalls}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <div className="space-y-4">
                {batchResponse.cases.map((caseResult) => (
                  <Card key={caseResult.caseId}>
                    <CardHeader>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base">{caseResult.title}</CardTitle>
                          <CardDescription>
                            Expected: {caseResult.expectedReferenceLabel} | Reference: {caseResult.referenceDecision.recommendation}
                          </CardDescription>
                        </div>
                        <Badge variant="outline">{caseResult.sourceType}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-xs text-muted-foreground">{caseResult.tags.join(", ")}</p>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {caseResult.results.map((result) => {
                          const mismatches = getMajorMismatches(
                            result,
                            caseResult.referenceChecks,
                            caseResult.referenceDecision,
                          )

                          return (
                            <div key={result.configId} className="rounded-lg border border-border p-3 text-sm">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <p className="font-medium text-foreground">{result.configLabel ?? result.modelLabel}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {result.configType ? `${result.configType === "workflow" ? "Workflow" : "Model-only"} | ` : ""}
                                    {result.workflowName ? `${result.workflowName} | ` : ""}
                                    {result.workflowType ? `${result.workflowType} | ` : ""}{result.promptStrategy}
                                    {result.workflowStepCount ? ` | ${result.workflowStepCount} steps` : ""}
                                  </p>
                                  {result.toolAssisted ? (
                                    <Badge variant="secondary" className="mt-1 text-xs">
                                      Tool-assisted
                                    </Badge>
                                  ) : null}
                                </div>
                                <Badge variant="outline">{result.status}</Badge>
                              </div>
                              {result.status === "error" ? (
                                <div className="mt-2 space-y-1">
                                  <p className="text-sm text-destructive">{formatBatchModelError(result)}</p>
                                  {isRateLimitedResult(result) && result.error ? (
                                    <p className="text-xs text-muted-foreground">{result.error}</p>
                                  ) : null}
                                  {typeof result.retryCount === "number" && result.retryCount > 0 ? (
                                    <p className="text-xs text-muted-foreground">Retries attempted: {result.retryCount}</p>
                                  ) : null}
                                  {result.failureReason && !isRateLimitedResult(result) ? (
                                    <p className="text-xs text-muted-foreground">Failure reason: {result.failureReason}</p>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="mt-3 space-y-2">
                                  <p className="text-muted-foreground">
                                    Output:{" "}
                                    <span className="font-medium text-foreground">
                                      {result.parsedOutput?.recommendation ?? "N/A"}
                                    </span>
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    <Badge variant="secondary">Rec {result.scores?.recommendationMatch ?? "N/A"}</Badge>
                                    <Badge variant="secondary">Criterion {result.scores?.alignment ?? "N/A"}</Badge>
                                    <Badge variant="secondary">Safety {result.scores?.safety ?? "N/A"}</Badge>
                                    <Badge variant="secondary">Explain {result.scores?.explainability ?? "N/A"}</Badge>
                                  </div>
                                  <p className="text-muted-foreground">
                                    Major mismatches: {mismatches.length > 0 ? mismatches.join(", ") : "none"}
                                  </p>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : !evaluationResponse ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">No evaluation run available yet.</CardTitle>
                <CardDescription>
                  Run a single evaluation on the Case Input page to populate benchmark results.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href="/">Back to Case Input</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
          {/* Summary Metrics Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Recommendation Match</p>
                    <p className="text-2xl font-bold text-foreground">
                      {averages.recommendationMatch === null ? "N/A" : `${averages.recommendationMatch.toFixed(1)}%`}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Info className="h-3 w-3 text-muted-foreground" />
                      Single-case average
                    </p>
                  </div>
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Target className="h-6 w-6 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Criterion Alignment</p>
                    <p className="text-2xl font-bold text-foreground">
                      {averages.alignment === null ? "N/A" : `${averages.alignment.toFixed(1)}%`}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Info className="h-3 w-3 text-muted-foreground" />
                      Logic-level average
                    </p>
                  </div>
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Target className="h-6 w-6 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Explainability</p>
                    <p className="text-2xl font-bold text-foreground">
                      {averages.explainability === null ? "—" : `${averages.explainability.toFixed(1)}%`}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Info className="h-3 w-3 text-muted-foreground" />
                      Single-case average
                    </p>
                  </div>
                  <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center">
                    <Lightbulb className="h-6 w-6 text-accent" />
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Safety Score</p>
                    <p className="text-2xl font-bold text-foreground">
                      {averages.safety === null ? "—" : `${averages.safety.toFixed(1)}%`}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Info className="h-3 w-3 text-muted-foreground" />
                      Single-case average
                    </p>
                  </div>
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <CheckCircle2 className="h-6 w-6 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <p className="text-sm text-muted-foreground mb-6">
            Single-case evaluation result. Robustness and batch metrics require a benchmark run.
            <span className="ml-2">Safety warnings: {averages.safetyWarnings}</span>
          </p>

          {/* Configuration Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {results.map((result) => {
              const alignment = result.scores?.alignment ?? null
              const safety = result.scores?.safety ?? null
              const explainability = result.scores?.explainability ?? null
              const recommendationMatch = getRecommendationMatch(result, evaluationResponse.referenceDecision.recommendation)
              const recommendation = result.parsedOutput?.recommendation ?? "—"
              const reasoningSummary = result.parsedOutput?.reasoning_summary ?? "—"
              const pctInterpretation = result.parsedOutput?.pct_interpretation ?? "—"
              const safetyWarnings = result.parsedOutput?.safety_warnings ?? []
              const parsedOutput = result.parsedOutput
              const referenceChecks = evaluationResponse.referenceChecks
              const isError = result.status === "error"

              const isHighAlignment = alignment !== null && alignment >= 90
              const isSafe = !isError && safetyWarnings.length === 0

              return (
                <Card key={result.configId} className={isHighAlignment ? "ring-2 ring-success/30" : ""}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">{result.configLabel ?? result.modelLabel}</CardTitle>
                        <CardDescription>
                          {result.configType ? `${result.configType === "workflow" ? "Workflow" : "Model-only"} | ` : ""}
                          {result.workflowName ? `${result.workflowName} | ` : ""}
                          {result.workflowType ? `${result.workflowType} | ` : ""}{result.promptStrategy}
                          {result.workflowStepCount ? ` | ${result.workflowStepCount} steps` : ""}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs h-5">
                        {result.status}
                      </Badge>
                      {result.toolAssisted ? (
                        <Badge variant="secondary" className="text-xs h-5">
                          Tool-assisted
                        </Badge>
                      ) : null}
                      {isSafe ? (
                        <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Safe
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-warning/10 text-warning-foreground border-warning/30">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Caution
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isError ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                      <p className="text-sm font-medium text-destructive">{MODEL_FAILURE_MESSAGE}</p>
                      <p className="text-sm text-muted-foreground mt-1">{result.error || "Unknown error"}</p>
                    </div>
                  ) : null}

                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Recommendation</p>
                    <p className="text-sm font-medium text-foreground">{recommendation}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Final recommendation match:{" "}
                      <span className="font-medium text-foreground">{formatMatch(recommendationMatch)}</span>
                    </p>
                  </div>
                  
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Reasoning Summary</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{reasoningSummary}</p>
                  </div>
                  
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">PCT Interpretation</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{pctInterpretation}</p>
                  </div>

                  {parsedOutput ? (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Structured Criteria</p>
                      <div className="grid grid-cols-1 gap-1 text-sm text-muted-foreground">
                        <div className="flex justify-between gap-3">
                          <span>Absolute threshold met</span>
                          <span className="text-right">
                            <span className="font-medium text-foreground">Model = {formatNullableBoolean(parsedOutput.absolute_threshold_met)}</span>
                            <span className="ml-2">Expected = {formatNullableBoolean(referenceChecks?.absoluteThresholdMet)}</span>
                            <span className={`ml-2 ${getStatusClass(getBooleanMatch(parsedOutput.absolute_threshold_met, referenceChecks?.absoluteThresholdMet))}`}>
                              {formatStatus(getBooleanMatch(parsedOutput.absolute_threshold_met, referenceChecks?.absoluteThresholdMet))}
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>PCT decline criterion met</span>
                          <span className="text-right">
                            <span className="font-medium text-foreground">Model = {formatNullableBoolean(parsedOutput.pct_decline_threshold_met)}</span>
                            <span className="ml-2">Expected = {formatNullableBoolean(referenceChecks?.pctDeclineCriterionMet)}</span>
                            <span className={`ml-2 ${getStatusClass(getBooleanMatch(parsedOutput.pct_decline_threshold_met, referenceChecks?.pctDeclineCriterionMet))}`}>
                              {formatStatus(getBooleanMatch(parsedOutput.pct_decline_threshold_met, referenceChecks?.pctDeclineCriterionMet))}
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Clinical improvement present</span>
                          <span className="text-right">
                            <span className="font-medium text-foreground">Model = {formatNullableBoolean(parsedOutput.clinical_improvement_present)}</span>
                            <span className="ml-2">Expected = {formatNullableBoolean(referenceChecks?.clinicalImprovementPresent)}</span>
                            <span className={`ml-2 ${getStatusClass(getBooleanMatch(parsedOutput.clinical_improvement_present, referenceChecks?.clinicalImprovementPresent))}`}>
                              {formatStatus(getBooleanMatch(parsedOutput.clinical_improvement_present, referenceChecks?.clinicalImprovementPresent))}
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Exclusion present</span>
                          <span className="text-right">
                            <span className="font-medium text-foreground">Model = {formatNullableBoolean(parsedOutput.exclusion_condition_present)}</span>
                            <span className="ml-2">Expected = {formatNullableBoolean(referenceChecks?.exclusionConditionPresent)}</span>
                            <span className={`ml-2 ${getStatusClass(getBooleanMatch(parsedOutput.exclusion_condition_present, referenceChecks?.exclusionConditionPresent))}`}>
                              {formatStatus(getBooleanMatch(parsedOutput.exclusion_condition_present, referenceChecks?.exclusionConditionPresent))}
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Discontinuation gate passed</span>
                          <span className="text-right">
                            <span className="font-medium text-foreground">Model = {formatNullableBoolean(parsedOutput.safety_gate_passed)}</span>
                            <span className="ml-2">Expected = {formatNullableBoolean(referenceChecks?.discontinuationGatePassed)}</span>
                            <span className={`ml-2 ${getStatusClass(getBooleanMatch(parsedOutput.safety_gate_passed, referenceChecks?.discontinuationGatePassed))}`}>
                              {formatStatus(getBooleanMatch(parsedOutput.safety_gate_passed, referenceChecks?.discontinuationGatePassed))}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {parsedOutput ? (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Calculation Audit</p>
                      <div className="grid grid-cols-1 gap-1 text-sm text-muted-foreground">
                        <div className="flex justify-between gap-3">
                          <span>Current PCT</span>
                          <span className="font-medium text-foreground">
                            {formatNullableNumber(parsedOutput.calculation_audit?.current_pct)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Threshold</span>
                          <span className="font-medium text-foreground">
                            {formatNullableNumber(parsedOutput.calculation_audit?.threshold_used)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Current PCT &lt;= threshold</span>
                          <span className="text-right">
                            <span className="font-medium text-foreground">
                              Model = {formatNullableBoolean(parsedOutput.calculation_audit?.current_pct_less_or_equal_threshold)}
                            </span>
                            <span className="ml-2">Expected = {formatNullableBoolean(referenceChecks?.absoluteThresholdMet)}</span>
                            <span className={`ml-2 ${getStatusClass(getBooleanMatch(parsedOutput.calculation_audit?.current_pct_less_or_equal_threshold, referenceChecks?.absoluteThresholdMet))}`}>
                              {formatStatus(getBooleanMatch(parsedOutput.calculation_audit?.current_pct_less_or_equal_threshold, referenceChecks?.absoluteThresholdMet))}
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Peak PCT</span>
                          <span className="font-medium text-foreground">
                            {formatNullableNumber(parsedOutput.calculation_audit?.peak_pct)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>PCT decline</span>
                          <span className="text-right">
                            <span className="font-medium text-foreground">
                              Model = {formatNullablePercent(parsedOutput.calculation_audit?.pct_decline_percent)}
                            </span>
                            <span className="ml-2">
                              Expected = {formatNullablePercent(evaluationResponse.referenceDecision.pctDeclinePercent)}
                            </span>
                            <span className={`ml-2 ${getStatusClass(getNumberMatch(parsedOutput.calculation_audit?.pct_decline_percent, evaluationResponse.referenceDecision.pctDeclinePercent, 5))}`}>
                              {formatStatus(getNumberMatch(parsedOutput.calculation_audit?.pct_decline_percent, evaluationResponse.referenceDecision.pctDeclinePercent, 5))}
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>PCT decline &gt;80%</span>
                          <span className="text-right">
                            <span className="font-medium text-foreground">
                              Model = {formatNullableBoolean(parsedOutput.calculation_audit?.pct_decline_greater_than_80)}
                            </span>
                            <span className="ml-2">Expected = {formatNullableBoolean(referenceChecks?.pctDeclineCriterionMet)}</span>
                            <span className={`ml-2 ${getStatusClass(getBooleanMatch(parsedOutput.calculation_audit?.pct_decline_greater_than_80, referenceChecks?.pctDeclineCriterionMet))}`}>
                              {formatStatus(getBooleanMatch(parsedOutput.calculation_audit?.pct_decline_greater_than_80, referenceChecks?.pctDeclineCriterionMet))}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Safety Warnings</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {safetyWarnings.length > 0 ? safetyWarnings.join(" | ") : "—"}
                    </p>
                  </div>
                  
                  <div className="pt-3 border-t border-border space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Final Recommendation Match</span>
                        <span className="text-xs font-medium">{recommendationMatch === null ? "N/A" : `${recommendationMatch}%`}</span>
                      </div>
                      <Progress
                        value={recommendationMatch ?? 0}
                        className="h-2"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Criterion Alignment Score</span>
                        <span className="text-xs font-medium">{alignment === null ? "—" : `${alignment}%`}</span>
                      </div>
                      <Progress 
                        value={alignment ?? 0} 
                        className="h-2"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Safety Score</span>
                        <span className="text-xs font-medium">{safety === null ? "—" : `${safety}%`}</span>
                      </div>
                      <Progress 
                        value={safety ?? 0} 
                        className="h-2"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Explainability</span>
                        <span className="text-xs font-medium">{explainability === null ? "—" : `${explainability}%`}</span>
                      </div>
                      <Progress 
                        value={explainability ?? 0} 
                        className="h-2"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
              )
            })}
          </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

