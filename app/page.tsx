"use client"

import { useState } from "react"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Header } from "@/components/dashboard/header"
import { CaseInputForm } from "@/components/dashboard/case-input-form"
import { SummaryPanel } from "@/components/dashboard/summary-panel"

const initialCaseData = {
  patientAge: "",
  sex: "",
  symptoms: "",
  infectionType: "",
  antibioticStatus: "",
  pctValue: "",
  wbcCount: "",
  crpValue: "",
  clinicalNotes: "",
  caseDescription: "",
}

export default function DashboardPage() {
  const [caseData, setCaseData] = useState(initialCaseData)

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar />
      
      <div className="flex-1 flex flex-col">
        <Header />
        
        <main className="flex-1 p-6 overflow-auto">
          <div className="max-w-6xl mx-auto">
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
