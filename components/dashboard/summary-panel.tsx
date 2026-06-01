"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CheckCircle2, AlertTriangle, Circle, FileText, Activity } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ClinicalCase } from "@/lib/types"
import { calculatePctDeclinePercent, getPctThreshold } from "@/lib/pct-reference"

interface SummaryPanelProps {
  caseData: ClinicalCase
}

interface FieldStatus {
  label: string
  filled: boolean
}

function formatNullableBoolean(value: boolean | null): string {
  if (value === true) return "Yes"
  if (value === false) return "No"
  return "Unknown"
}

function formatThreshold(value: number | null): string {
  return value === null ? "unknown" : `${value} ng/mL`
}

function formatPct(value: number | null): string {
  return value === null ? "not provided" : `${value} ng/mL`
}

function formatPctDecline(value: number | null): string {
  return value === null ? "Unknown" : `${value.toFixed(1)}%`
}

function getInfectionContextLabel(context: ClinicalCase["infectionContext"]): string {
  switch (context) {
    case "lrti_non_icu":
      return "LRTI/non-ICU"
    case "sepsis_icu":
      return "sepsis/ICU"
    case "other_or_unclear":
      return "other/unclear infection"
    default: {
      const _exhaustive: never = context
      return _exhaustive
    }
  }
}

function getBenchmarkImplication(args: {
  clinicalImprovement: ClinicalCase["clinicalImprovement"]
  exclusionCondition: ClinicalCase["exclusionCondition"]
  absoluteThresholdMet: boolean | null
  pctDeclineCriterionMet: boolean | null
  threshold: number | null
}): string {
  const {
    clinicalImprovement,
    exclusionCondition,
    absoluteThresholdMet,
    pctDeclineCriterionMet,
    threshold,
  } = args

  if (exclusionCondition !== "none") {
    return "an exclusion/caution condition is present, so clinical review is required by the benchmark reference logic."
  }

  if (clinicalImprovement === "no") {
    return "clinical improvement is absent, so discontinuation should not be supported by the reference logic."
  }

  if (clinicalImprovement === "unclear") {
    return "clinical improvement is unclear, so the reference logic treats discontinuation support as insufficiently established."
  }

  if (threshold === null) {
    return "the infection context has no benchmark threshold, so discontinuation support is limited by missing threshold logic."
  }

  if (absoluteThresholdMet || pctDeclineCriterionMet) {
    return "clinical improvement is present and at least one PCT criterion is met, so discontinuation may be considered by the reference logic."
  }

  return "clinical improvement is present, but neither PCT discontinuation criterion is met, so discontinuation should not be supported by the reference logic."
}

export function SummaryPanel({ caseData }: SummaryPanelProps) {
  const benchmarkFields: FieldStatus[] = [
    { label: "Infection Context", filled: !!caseData.infectionContext },
    { label: "Clinical Improvement", filled: !!caseData.clinicalImprovement },
    { label: "Peak PCT", filled: caseData.peakPct !== null },
    { label: "Current PCT", filled: caseData.currentPct !== null },
    { label: "Exclusion / Caution Condition", filled: !!caseData.exclusionCondition },
  ]

  const clinicalContextFields: FieldStatus[] = [
    { label: "Patient Age", filled: caseData.patientAge !== null },
    { label: "Sex", filled: !!caseData.sex },
    { label: "Symptoms", filled: !!caseData.symptoms },
    { label: "Current Antibiotic Status", filled: !!caseData.currentAntibioticStatus },
    { label: "Antibiotics Duration Days", filled: caseData.antibioticsDurationDays !== null },
    { label: "WBC", filled: caseData.wbc !== null },
    { label: "CRP", filled: caseData.crp !== null },
    { label: "Clinical Notes", filled: !!caseData.clinicalNotes },
    { label: "Case Description", filled: !!caseData.caseDescription },
  ]

  const filledBenchmarkFields = benchmarkFields.filter((field) => field.filled).length
  const filledClinicalContextFields = clinicalContextFields.filter((field) => field.filled).length
  const completionPercent = Math.round((filledBenchmarkFields / benchmarkFields.length) * 100)
  const missingBenchmarkFields = benchmarkFields.filter((field) => !field.filled)
  const isBenchmarkComplete = missingBenchmarkFields.length === 0

  const threshold = getPctThreshold(caseData.infectionContext)
  const pctDeclinePercent = calculatePctDeclinePercent(caseData.peakPct, caseData.currentPct)
  const absoluteThresholdMet =
    caseData.currentPct !== null && threshold !== null ? caseData.currentPct <= threshold : null
  const pctDeclineCriterionMet = pctDeclinePercent !== null ? pctDeclinePercent > 80 : null
  const contextLabel = getInfectionContextLabel(caseData.infectionContext)
  const thresholdComparison =
    caseData.currentPct === null || threshold === null
      ? "cannot be compared with a benchmark threshold"
      : absoluteThresholdMet
        ? `at or below the ${threshold} ng/mL threshold`
        : `above the ${threshold} ng/mL threshold`
  const pctDeclineText =
    pctDeclinePercent === null ? "PCT decline is unknown" : `PCT decline is ${pctDeclinePercent.toFixed(1)}%`
  const ageSex =
    caseData.patientAge !== null && caseData.sex
      ? `${caseData.patientAge}-year-old ${caseData.sex}`
      : "Patient"
  const exclusionText =
    caseData.exclusionCondition === "none"
      ? "no exclusion/caution condition is selected"
      : `exclusion/caution status is ${caseData.exclusionCondition}`
  const benchmarkImplication = getBenchmarkImplication({
    clinicalImprovement: caseData.clinicalImprovement,
    exclusionCondition: caseData.exclusionCondition,
    absoluteThresholdMet,
    pctDeclineCriterionMet,
    threshold,
  })
  const contextSummary = `${ageSex}, ${contextLabel} context. Current PCT is ${formatPct(caseData.currentPct)}, ${thresholdComparison}, while ${pctDeclineText}. Clinical improvement is ${caseData.clinicalImprovement}, and ${exclusionText}; ${benchmarkImplication}`

  const renderFieldStatus = (field: FieldStatus, required: boolean) => (
    <div key={field.label} className="flex items-center gap-2 text-sm">
      {field.filled ? (
        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
      ) : (
        <Circle className={cn("w-4 h-4 shrink-0", required ? "text-muted-foreground" : "text-muted-foreground/50")} />
      )}
      <span className={cn(field.filled ? "text-foreground" : "text-muted-foreground", !required && "text-muted-foreground")}>
        {field.label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
    </div>
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Input Completeness
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-muted-foreground">Benchmark inputs</span>
              <span className={cn("text-sm font-medium", isBenchmarkComplete ? "text-success" : "text-foreground")}>
                {filledBenchmarkFields}/{benchmarkFields.length}
              </span>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Clinical context fields</span>
              <span className="text-xs font-medium text-muted-foreground">
                {filledClinicalContextFields}/{clinicalContextFields.length}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all duration-300 rounded-full",
                  isBenchmarkComplete ? "bg-success" : "bg-primary",
                )}
                style={{ width: `${completionPercent}%` }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                Benchmark-required fields
              </p>
              <div className="space-y-1.5">
                {benchmarkFields.map((field) => renderFieldStatus(field, true))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                Clinical-context fields
              </p>
              <div className="space-y-1.5">
                {clinicalContextFields.map((field) => renderFieldStatus(field, false))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {missingBenchmarkFields.length > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="pt-4">
            <div className="flex gap-3">
              <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-warning-foreground">Missing Benchmark Inputs</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {missingBenchmarkFields.map((field) => field.label).join(", ")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Current PCT Interpretation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">Threshold</span>
              <span className="text-sm font-medium text-foreground">{formatThreshold(threshold)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">Current PCT</span>
              <span className="text-sm font-medium text-foreground">{formatPct(caseData.currentPct)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">Absolute threshold met</span>
              <span className="text-sm font-medium text-foreground">{formatNullableBoolean(absoluteThresholdMet)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">PCT decline from peak</span>
              <span className="text-sm font-medium text-foreground">{formatPctDecline(pctDeclinePercent)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">PCT decline criterion met</span>
              <span className="text-sm font-medium text-foreground">{formatNullableBoolean(pctDeclineCriterionMet)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            Clinical Context Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {contextSummary}
          </p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center px-2">
        This tool is for research and educational purposes. Always consult clinical guidelines and institutional protocols.
      </p>
    </div>
  )
}
