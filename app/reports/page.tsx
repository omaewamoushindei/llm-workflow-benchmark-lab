"use client"

import { useEffect, useMemo, useState } from "react"

import { Header } from "@/components/dashboard/header"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
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
  AlertOctagon,
  AlertTriangle,
  Award,
  Brain,
  CheckCircle2,
  Download,
  FileText,
  Info,
  Save,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
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

function formatDate(value: string | undefined): string {
  if (!value) return "N/A"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
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
  const [reportCriteria, setReportCriteria] = useState<EvaluationCriterion[]>(() => parseEvaluationCriteria(null))

  useEffect(() => {
    try {
      const storedBatch = sessionStorage.getItem("latestBatchEvaluationResponse")
      const storedCriteria = sessionStorage.getItem(LATEST_EVALUATION_CRITERIA_STORAGE_KEY)
      const parsedBatch = storedBatch ? (JSON.parse(storedBatch) as BatchEvaluationResponse) : null
      setBatchResponse(parsedBatch)
      setReportCriteria(
        parsedBatch?.criteriaSettings ??
          parseEvaluationCriteria(storedCriteria),
      )
    } catch {
      setBatchResponse(null)
      setReportCriteria(parseEvaluationCriteria(null))
    }
  }, [])

  const rankings = useMemo(() => {
    return batchResponse ? buildModelRankings(batchResponse, reportCriteria) : mockRankings
  }, [batchResponse, reportCriteria])
  const activeReportScoringCriteria = getScoringCriteria(reportCriteria)
  const reportOnlyCriteria = getReportOnlyCriteria(reportCriteria)
  const activeReportWeight = getActiveScoringWeight(reportCriteria)
  const bestConfiguration = rankings[0]
  const weakestCases = useMemo(() => {
    return batchResponse ? buildWeakestCases(batchResponse) : []
  }, [batchResponse])
  const unsafeExamples = useMemo(() => {
    return batchResponse ? getUnsafeRecommendationExamples(batchResponse) : []
  }, [batchResponse])
  const failedCalls = useMemo(() => {
    return batchResponse ? getFailedCalls(batchResponse) : []
  }, [batchResponse])
  const rateLimitedCalls = failedCalls.filter((call) => call.failureReason === "rate_limited")
  const matchedLowCriterion = useMemo(() => {
    return batchResponse ? getMatchedButLowCriterionExamples(batchResponse) : []
  }, [batchResponse])
  const isRealReport = Boolean(batchResponse)

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar activePage="Reports" />

      <div className="flex-1 flex flex-col">
        <Header
          title="Suitability Report"
          description="LLM Configuration Assessment for PCT-Guided Antibiotic Stewardship"
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
                    {isRealReport ? "Generated from latest batch benchmark run" : "Mock report view for proposal/demo purposes."}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isRealReport
                      ? "This report is computed from sessionStorage.latestBatchEvaluationResponse and is not persisted on the server."
                      : "Run a batch benchmark to replace these illustrative/mock values with real aggregate reporting."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-muted-foreground">
                Report Generated: {isRealReport ? formatDate(batchResponse?.createdAt) : "Demo"}
              </Badge>
              <Badge variant="outline" className="text-muted-foreground">
                {isRealReport ? `${batchResponse?.caseCount ?? 0} Cases Evaluated` : "48 Cases Evaluated (Mock)"}
              </Badge>
              <Badge variant="outline" className="text-muted-foreground">
                {isRealReport
                  ? `${batchResponse?.totalConfigCount ?? batchResponse?.configCount ?? batchResponse?.modelCount ?? 0} Configurations Tested`
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
                    Batch <span className="font-medium">{batchResponse?.batchId}</span> evaluated{" "}
                    <span className="font-medium">{batchResponse?.caseCount}</span> cases across{" "}
                    <span className="font-medium">
                      {batchResponse?.totalConfigCount ?? batchResponse?.configCount ?? batchResponse?.modelCount}
                    </span>{" "}
                    benchmark configurations using{" "}
                    <span className="font-medium">{batchResponse?.providerId}</span>.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2">
                    <MetricCard label="Recommendation Match" value={formatScore(batchResponse?.aggregate.averageRecommendationMatch)} icon={<Target className="h-5 w-5 text-primary" />} />
                    <MetricCard label="Criterion Alignment" value={formatScore(batchResponse?.aggregate.averageCriterionAlignment)} icon={<TrendingUp className="h-5 w-5 text-primary" />} />
                    <MetricCard label="Safety Score" value={formatScore(batchResponse?.aggregate.averageSafety)} icon={<Shield className="h-5 w-5 text-success" />} />
                    <MetricCard label="Explainability" value={formatScore(batchResponse?.aggregate.averageExplainability)} icon={<Brain className="h-5 w-5 text-accent" />} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <MetricCard label="Failed Model Calls" value={String(batchResponse?.aggregate.failedModelCalls ?? 0)} icon={<XCircle className="h-5 w-5 text-destructive" />} />
                    <MetricCard label="Unsafe / Caution Findings" value={String(batchResponse?.aggregate.totalSafetyWarnings ?? 0)} icon={<AlertTriangle className="h-5 w-5 text-warning" />} />
                  </div>
                </>
              ) : (
                <p className="text-foreground leading-relaxed">
                  This is an illustrative/mock executive summary for proposal/demo purposes. Run a batch benchmark to generate provider, case, model, and score metrics from real results.
                </p>
              )}
            </CardContent>
          </Card>

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
                  Thermo Fisher adapted cases are used for realism but are not complete clinical gold-standard patient records.
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
