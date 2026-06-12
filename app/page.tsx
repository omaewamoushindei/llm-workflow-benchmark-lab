"use client"

import { useEffect, useState } from "react"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Header } from "@/components/dashboard/header"
import { CaseInputForm } from "@/components/dashboard/case-input-form"
import { SummaryPanel } from "@/components/dashboard/summary-panel"
import type { ClinicalCase } from "@/lib/types"

const initialCaseData: ClinicalCase = {
  patientAge: null,
  sex: "",
  symptoms: "",
  infectionContext: "lrti_non_icu",
  clinicalImprovement: "unclear",
  currentAntibioticStatus: "",
  antibioticsDurationDays: null,
  peakPct: null,
  currentPct: null,
  wbc: null,
  crp: null,
  exclusionCondition: "none",
  clinicalNotes: "",
  caseDescription: "",
}

export default function DashboardPage() {
  const [caseData, setCaseData] = useState(initialCaseData)

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("latestClinicalCase")
      if (!stored) return
      const parsed = JSON.parse(stored) as Partial<ClinicalCase>
      setCaseData({ ...initialCaseData, ...parsed })
    } catch {
      // Ignore invalid session storage payloads.
    }
  }, [])

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar activePage="Single Case Execution" />
      
      <div className="flex-1 flex flex-col">
        <Header 
          title="Single Case Execution" 
          description="Run one simplified PCT case through a selected evaluated configuration. Prototype only, not for clinical use."
        />
        
        <main className="flex-1 p-6 overflow-auto">
          <div className="max-w-6xl mx-auto">
            <div className="mb-6 rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-sm font-medium text-foreground">Example workspace: PCT-guided antibiotic stewardship</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Single-case execution is separate from aggregate benchmark reports unless saved as a benchmark case.
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Main Form - Takes 2 columns */}
              <div className="lg:col-span-2">
                <CaseInputForm 
                  caseData={caseData} 
                  onCaseDataChange={setCaseData} 
                />
              </div>
              
              {/* Summary Panel - Takes 1 column */}
              <div className="lg:col-span-1">
                <div className="sticky top-6">
                  <SummaryPanel caseData={caseData} />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
