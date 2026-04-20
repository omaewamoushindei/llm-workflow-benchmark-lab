"use client"

import { useState } from "react"
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
import { Upload, FileText, Play, FlaskConical } from "lucide-react"

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

interface CaseInputFormProps {
  caseData: CaseData
  onCaseDataChange: (data: CaseData) => void
}

export function CaseInputForm({ caseData, onCaseDataChange }: CaseInputFormProps) {
  const [dragActive, setDragActive] = useState(false)

  const handleChange = (field: keyof CaseData, value: string) => {
    onCaseDataChange({ ...caseData, [field]: value })
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

  const loadExampleCase = () => {
    onCaseDataChange({
      patientAge: "67",
      sex: "male",
      symptoms: "Fever, productive cough, dyspnea, fatigue",
      infectionType: "respiratory",
      antibioticStatus: "not-started",
      pctValue: "0.85",
      wbcCount: "14.2",
      crpValue: "95",
      clinicalNotes: "Patient admitted with suspected community-acquired pneumonia. Chest X-ray shows right lower lobe consolidation. No recent hospitalizations or antibiotic use in past 90 days.",
      caseDescription: "67-year-old male presenting with 3-day history of fever (38.9°C), productive cough with purulent sputum, and progressive dyspnea. SpO2 92% on room air. Physical exam reveals crackles in right lung base."
    })
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
                value={caseData.patientAge}
                onChange={(e) => handleChange("patientAge", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sex">Sex</Label>
              <Select value={caseData.sex} onValueChange={(v) => handleChange("sex", v)}>
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
              onChange={(e) => handleChange("symptoms", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="infectionType">Suspected Infection Type</Label>
              <Select value={caseData.infectionType} onValueChange={(v) => handleChange("infectionType", v)}>
                <SelectTrigger id="infectionType">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="respiratory">Respiratory</SelectItem>
                  <SelectItem value="urinary">Urinary Tract</SelectItem>
                  <SelectItem value="skin">Skin/Soft Tissue</SelectItem>
                  <SelectItem value="abdominal">Abdominal</SelectItem>
                  <SelectItem value="bloodstream">Bloodstream</SelectItem>
                  <SelectItem value="unknown">Unknown/Uncertain</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="antibioticStatus">Current Antibiotic Status</Label>
              <Select value={caseData.antibioticStatus} onValueChange={(v) => handleChange("antibioticStatus", v)}>
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

          {/* Lab Values */}
          <div className="pt-2">
            <h4 className="text-sm font-medium text-foreground mb-3">Laboratory Values</h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pctValue">
                  Procalcitonin (PCT)
                  <span className="text-muted-foreground font-normal ml-1">ng/mL</span>
                </Label>
                <Input
                  id="pctValue"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 0.5"
                  value={caseData.pctValue}
                  onChange={(e) => handleChange("pctValue", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wbcCount">
                  WBC Count
                  <span className="text-muted-foreground font-normal ml-1">×10⁹/L</span>
                </Label>
                <Input
                  id="wbcCount"
                  type="number"
                  step="0.1"
                  placeholder="e.g., 12.5"
                  value={caseData.wbcCount}
                  onChange={(e) => handleChange("wbcCount", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crpValue">
                  CRP
                  <span className="text-muted-foreground font-normal ml-1">mg/L</span>
                </Label>
                <Input
                  id="crpValue"
                  type="number"
                  step="0.1"
                  placeholder="e.g., 85"
                  value={caseData.crpValue}
                  onChange={(e) => handleChange("crpValue", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Clinical Notes */}
          <div className="space-y-2">
            <Label htmlFor="clinicalNotes">Clinical Notes</Label>
            <Textarea
              id="clinicalNotes"
              placeholder="Additional clinical observations, history, or relevant context..."
              rows={3}
              value={caseData.clinicalNotes}
              onChange={(e) => handleChange("clinicalNotes", e.target.value)}
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
              onChange={(e) => handleChange("caseDescription", e.target.value)}
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
      <div className="flex gap-3">
        <Button className="flex-1 gap-2" size="lg">
          <Play className="w-4 h-4" />
          Run Evaluation
        </Button>
        <Button variant="secondary" size="lg" onClick={loadExampleCase}>
          Load Example Case
        </Button>
      </div>
    </div>
  )
}
