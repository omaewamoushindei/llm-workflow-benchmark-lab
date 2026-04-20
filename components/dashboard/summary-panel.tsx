"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CheckCircle2, AlertTriangle, Circle, FileText, Activity } from "lucide-react"
import { cn } from "@/lib/utils"

interface CaseData {
  patientAge: string
  sex: string
  symptoms: string
  infectionType: string
  antibioticStatus: string
  pctValue: string
  wbcCount: string
  crpValue: string
  clinicalNotes: string
  caseDescription: string
}

interface SummaryPanelProps {
  caseData: CaseData
}

interface FieldStatus {
  label: string
  filled: boolean
  required: boolean
}

export function SummaryPanel({ caseData }: SummaryPanelProps) {
  const fields: FieldStatus[] = [
    { label: "Patient Age", filled: !!caseData.patientAge, required: true },
    { label: "Sex", filled: !!caseData.sex, required: true },
    { label: "Symptoms", filled: !!caseData.symptoms, required: true },
    { label: "Infection Type", filled: !!caseData.infectionType, required: true },
    { label: "Antibiotic Status", filled: !!caseData.antibioticStatus, required: true },
    { label: "PCT Value", filled: !!caseData.pctValue, required: true },
    { label: "WBC Count", filled: !!caseData.wbcCount, required: false },
    { label: "CRP", filled: !!caseData.crpValue, required: false },
    { label: "Clinical Notes", filled: !!caseData.clinicalNotes, required: false },
    { label: "Case Description", filled: !!caseData.caseDescription, required: false },
  ]

  const requiredFields = fields.filter(f => f.required)
  const filledRequired = requiredFields.filter(f => f.filled).length
  const totalRequired = requiredFields.length
  const completionPercent = Math.round((filledRequired / totalRequired) * 100)

  const missingRequired = requiredFields.filter(f => !f.filled)
  const isComplete = missingRequired.length === 0

  // Generate clinical context summary
  const getContextSummary = () => {
    const parts: string[] = []
    
    if (caseData.patientAge && caseData.sex) {
      parts.push(`${caseData.patientAge}-year-old ${caseData.sex}`)
    }
    
    if (caseData.infectionType) {
      const types: Record<string, string> = {
        respiratory: "suspected respiratory infection",
        urinary: "suspected urinary tract infection",
        skin: "suspected skin/soft tissue infection",
        abdominal: "suspected abdominal infection",
        bloodstream: "suspected bloodstream infection",
        unknown: "infection of unknown origin",
      }
      parts.push(types[caseData.infectionType] || caseData.infectionType)
    }
    
    if (caseData.pctValue) {
      const pct = parseFloat(caseData.pctValue)
      let pctInterpretation = ""
      if (pct < 0.1) pctInterpretation = "PCT suggests low bacterial infection risk"
      else if (pct < 0.25) pctInterpretation = "PCT in gray zone"
      else if (pct < 0.5) pctInterpretation = "PCT suggests possible bacterial infection"
      else pctInterpretation = "PCT suggests likely bacterial infection"
      parts.push(pctInterpretation)
    }

    return parts.length > 0 ? parts.join(". ") + "." : "No clinical context available yet."
  }

  // PCT interpretation
  const getPCTInterpretation = () => {
    if (!caseData.pctValue) return null
    const pct = parseFloat(caseData.pctValue)
    
    if (pct < 0.1) return { level: "Very Low", color: "text-success", recommendation: "Antibiotic initiation strongly discouraged" }
    if (pct < 0.25) return { level: "Low", color: "text-success", recommendation: "Antibiotic initiation discouraged" }
    if (pct < 0.5) return { level: "Moderate", color: "text-warning", recommendation: "Antibiotic initiation encouraged" }
    return { level: "High", color: "text-destructive", recommendation: "Antibiotic initiation strongly encouraged" }
  }

  const pctInterpretation = getPCTInterpretation()

  return (
    <div className="space-y-4">
      {/* Completeness Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Input Completeness
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Progress Bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Required fields</span>
              <span className={cn(
                "text-sm font-medium",
                isComplete ? "text-success" : "text-foreground"
              )}>
                {filledRequired}/{totalRequired}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all duration-300 rounded-full",
                  isComplete ? "bg-success" : "bg-primary"
                )}
                style={{ width: `${completionPercent}%` }}
              />
            </div>
          </div>

          {/* Field Status List */}
          <div className="space-y-1.5">
            {fields.map((field) => (
              <div key={field.label} className="flex items-center gap-2 text-sm">
                {field.filled ? (
                  <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                ) : field.required ? (
                  <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
                )}
                <span className={cn(
                  field.filled ? "text-foreground" : "text-muted-foreground",
                  !field.required && "text-muted-foreground"
                )}>
                  {field.label}
                  {field.required && <span className="text-destructive ml-0.5">*</span>}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Missing Fields Warning */}
      {missingRequired.length > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="pt-4">
            <div className="flex gap-3">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-warning-foreground">Missing Required Fields</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {missingRequired.map(f => f.label).join(", ")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* PCT Interpretation */}
      {pctInterpretation && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">PCT Interpretation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Level</span>
                <span className={cn("text-sm font-medium", pctInterpretation.color)}>
                  {pctInterpretation.level} ({caseData.pctValue} ng/mL)
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {pctInterpretation.recommendation}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Clinical Context Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            Clinical Context Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {getContextSummary()}
          </p>
        </CardContent>
      </Card>

      {/* Disclaimer */}
      <p className="text-xs text-muted-foreground text-center px-2">
        This tool is for research and educational purposes. Always consult clinical guidelines and institutional protocols.
      </p>
    </div>
  )
}
