"use client"

import { useEffect, useState } from "react"
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
import type { ClinicalCase, EvaluationResponse } from "@/lib/types"
import { calculatePctDeclinePercent } from "@/lib/pct-reference"
import { benchmarkCases, type BenchmarkCase } from "@/lib/benchmark-cases"
import { DEFAULT_PROMPT_TEMPLATES } from "@/lib/prompt-templates"
import { Upload, FileText, Play, FlaskConical, Loader2 } from "lucide-react"

interface CaseInputFormProps {
  caseData: ClinicalCase
  onCaseDataChange: (data: ClinicalCase) => void
}

const EVALUATION_SETTINGS_STORAGE_KEY = "evaluationSettings"
const PROVIDER_API_KEYS_STORAGE_KEY = "providerApiKeys"
const PROMPT_TEMPLATES_STORAGE_KEY = "promptTemplates"
const DEFAULT_MODEL_ONLY_PROMPT_TEMPLATE_ID = "default-baseline-pct"
const MODEL_FAILURE_MESSAGE =
  "This model failed or is unavailable. Refresh models or choose another model in Evaluation Setup."

type ProviderId = "openrouter" | "groq"
type BenchmarkCaseFilter =
  | "all"
  | "thermo"
  | "synthetic"
  | "safety_exceptions"
  | "threshold"
  | "missing_information"
  | "lrti"
  | "sepsis_icu"

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
    ? "Adapted from public Thermo Fisher PCT case study. Not a complete clinical gold standard."
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

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("latestEvaluationResponse")
      if (!stored) return
      const parsed = JSON.parse(stored) as EvaluationResponse
      setEvaluationResponse(parsed)
    } catch {
      // Ignore invalid session storage payloads.
    }
  }, [])

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
    }
  }

  const selectedBenchmarkCase =
    benchmarkCases.find((benchmarkCase) => benchmarkCase.id === selectedBenchmarkCaseId) ?? null
  const filteredBenchmarkCases = benchmarkCases.filter((benchmarkCase) =>
    benchmarkCaseMatchesFilter(benchmarkCase, benchmarkCaseFilter),
  )

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

  const pctDeclinePercent = calculatePctDeclinePercent(caseData.peakPct, caseData.currentPct)

  const runEvaluation = async () => {
    setIsRunning(true)
    setError(null)

    try {
      const evaluationSettings = readEvaluationSettings()
      const apiKey = readProviderApiKey(evaluationSettings.providerId)

      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          caseData,
          providerId: evaluationSettings.providerId,
          apiKey,
          selectedModelIds: evaluationSettings.selectedModelIds,
          defaultPromptTemplateId: evaluationSettings.defaultPromptTemplateId,
          defaultPromptTemplateText: evaluationSettings.defaultPromptTemplateText,
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || `Request failed with status ${response.status}`)
      }

      const json = (await response.json()) as EvaluationResponse
      setEvaluationResponse(json)
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
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Patient Information</CardTitle>
              <CardDescription>Enter patient demographics and clinical parameters</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Demographics Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="patientAge">Patient Age</Label>
              <Input
                id="patientAge"
                type="number"
                placeholder="e.g., 65"
                value={caseData.patientAge ?? ""}
                onChange={(e) => updateCaseData({ patientAge: parseNullableNumber(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sex">Sex</Label>
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
            <Label htmlFor="symptoms">Symptoms</Label>
            <Input
              id="symptoms"
              placeholder="e.g., Fever, cough, fatigue"
              value={caseData.symptoms}
              onChange={(e) => updateCaseData({ symptoms: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="infectionContext">Infection Context</Label>
              <Select
                value={caseData.infectionContext}
                onValueChange={(v) => updateCaseData({ infectionContext: v as ClinicalCase["infectionContext"] })}
              >
                <SelectTrigger id="infectionContext">
                  <SelectValue placeholder="Select context" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lrti_non_icu">LRTI (Non-ICU)</SelectItem>
                  <SelectItem value="sepsis_icu">Sepsis (ICU)</SelectItem>
                  <SelectItem value="other_or_unclear">Other / Unclear</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="antibioticStatus">Current Antibiotic Status</Label>
              <Select
                value={caseData.currentAntibioticStatus}
                onValueChange={(v) => updateCaseData({ currentAntibioticStatus: v })}
              >
                <SelectTrigger id="antibioticStatus">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not-started">Not Started</SelectItem>
                  <SelectItem value="empirical">Empirical Therapy</SelectItem>
                  <SelectItem value="targeted">Targeted Therapy</SelectItem>
                  <SelectItem value="de-escalation">De-escalation</SelectItem>
                  <SelectItem value="completed">Completed Course</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="clinicalImprovement">Clinical Improvement</Label>
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
                  Peak PCT
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
                  Current PCT
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
                <Label htmlFor="exclusionCondition">Exclusion / Caution Condition</Label>
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
            <Label htmlFor="clinicalNotes">Clinical Notes</Label>
            <Textarea
              id="clinicalNotes"
              placeholder="Additional clinical observations, history, or relevant context..."
              rows={3}
              value={caseData.clinicalNotes}
              onChange={(e) => updateCaseData({ clinicalNotes: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Case Description Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-accent" />
            </div>
            <div>
              <CardTitle className="text-lg">Case Description</CardTitle>
              <CardDescription>Paste a full case description or upload a file</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="caseDescription">Paste case description</Label>
            <Textarea
              id="caseDescription"
              placeholder="Paste the full clinical case description here..."
              rows={4}
              value={caseData.caseDescription}
              onChange={(e) => updateCaseData({ caseDescription: e.target.value })}
            />
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
              Drag and drop or click to browse
            </p>
            <p className="text-xs text-muted-foreground">
              Supports: PDF, TXT, DOCX
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button className="flex-1 gap-2" size="lg" onClick={runEvaluation} disabled={isRunning}>
          {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {isRunning ? "Running..." : "Run Evaluation"}
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
              <CardTitle className="text-sm font-medium">Reference Decision</CardTitle>
              <CardDescription>Deterministic benchmark proxy (not medical advice)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <div>
                  <span className="text-muted-foreground">Recommendation: </span>
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
                <p className="text-muted-foreground">Explanation</p>
                <p className="mt-1 text-muted-foreground leading-relaxed">
                  {evaluationResponse.referenceDecision.explanation}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">LLM Results</CardTitle>
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
                        <p className="text-muted-foreground">Reasoning Summary</p>
                        <p className="mt-1 text-muted-foreground leading-relaxed">
                          {result.parsedOutput.reasoning_summary}
                        </p>
                      </div>

                      <div>
                        <p className="text-muted-foreground">Safety Warnings</p>
                        <p className="mt-1">
                          {result.parsedOutput.safety_warnings.length > 0
                            ? result.parsedOutput.safety_warnings.join(" | ")
                            : "—"}
                        </p>
                      </div>
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

