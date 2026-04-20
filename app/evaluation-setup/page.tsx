"use client"

import { useState } from "react"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Header } from "@/components/dashboard/header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { 
  Play, 
  Save, 
  Sparkles,
  Brain,
  Zap,
  Bot,
  CheckCircle2,
  Shield,
  Eye,
  AlertTriangle,
  RefreshCw
} from "lucide-react"

const models = [
  { id: "gpt4", name: "GPT-4", provider: "OpenAI", icon: Sparkles },
  { id: "claude", name: "Claude", provider: "Anthropic", icon: Brain },
  { id: "gemini", name: "Gemini", provider: "Google", icon: Zap },
  { id: "llama", name: "Llama", provider: "Meta", icon: Bot },
]

const promptStrategies = [
  { 
    id: "baseline", 
    name: "Baseline prompt", 
    description: "Standard clinical query without structured reasoning"
  },
  { 
    id: "structured", 
    name: "Structured clinical reasoning prompt", 
    description: "Step-by-step reasoning with clinical context"
  },
  { 
    id: "json", 
    name: "JSON output prompt", 
    description: "Structured JSON response for automated processing"
  },
  { 
    id: "multistep", 
    name: "Multi-step verification workflow", 
    description: "Chain-of-thought with verification steps"
  },
]

const evaluationCriteria = [
  { 
    id: "guideline", 
    name: "Guideline alignment", 
    description: "Adherence to PCT-guided antibiotic stewardship guidelines",
    icon: CheckCircle2
  },
  { 
    id: "explainability", 
    name: "Explainability", 
    description: "Clear reasoning and justification for recommendations",
    icon: Eye
  },
  { 
    id: "hallucination", 
    name: "Hallucination detection", 
    description: "Detection of fabricated or unsupported claims",
    icon: AlertTriangle
  },
  { 
    id: "safety", 
    name: "Safety risk detection", 
    description: "Identification of potentially harmful recommendations",
    icon: Shield
  },
  { 
    id: "robustness", 
    name: "Robustness across case variations", 
    description: "Consistency across similar clinical scenarios",
    icon: RefreshCw
  },
]

export default function EvaluationSetupPage() {
  const [selectedModels, setSelectedModels] = useState<string[]>(["gpt4", "claude"])
  const [selectedStrategy, setSelectedStrategy] = useState("structured")
  const [selectedCriteria, setSelectedCriteria] = useState<string[]>(["guideline", "explainability", "safety"])
  const [numberOfCases, setNumberOfCases] = useState("10")
  const [batchRun, setBatchRun] = useState(true)
  const [storeOutputs, setStoreOutputs] = useState(true)
  const [generateReport, setGenerateReport] = useState(true)

  const toggleModel = (modelId: string) => {
    setSelectedModels(prev => 
      prev.includes(modelId) 
        ? prev.filter(id => id !== modelId)
        : [...prev, modelId]
    )
  }

  const toggleCriteria = (criteriaId: string) => {
    setSelectedCriteria(prev => 
      prev.includes(criteriaId) 
        ? prev.filter(id => id !== criteriaId)
        : [...prev, criteriaId]
    )
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar activePage="Evaluation Setup" />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header 
          title="Evaluation Setup" 
          description="Configure LLMs and evaluation parameters for benchmark testing"
        />
        
        <main className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-7xl">
            {/* Left Column */}
            <div className="space-y-6">
              {/* Model Selection */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Model Selection</CardTitle>
                  <CardDescription>Choose which LLMs to include in the benchmark</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    {models.map((model) => {
                      const isSelected = selectedModels.includes(model.id)
                      const Icon = model.icon
                      return (
                        <button
                          key={model.id}
                          onClick={() => toggleModel(model.id)}
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
                              <Icon className={`w-5 h-5 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                            </div>
                            <div>
                              <p className={`font-medium text-sm ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
                                {model.name}
                              </p>
                              <p className="text-xs text-muted-foreground">{model.provider}</p>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Prompt Strategy */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Prompt Strategy</CardTitle>
                  <CardDescription>Select the prompting approach for evaluation</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {promptStrategies.map((strategy) => (
                      <label
                        key={strategy.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                          selectedStrategy === strategy.id 
                            ? "border-primary bg-primary/5" 
                            : "border-border hover:border-muted-foreground/30"
                        }`}
                      >
                        <input
                          type="radio"
                          name="strategy"
                          value={strategy.id}
                          checked={selectedStrategy === strategy.id}
                          onChange={() => setSelectedStrategy(strategy.id)}
                          className="mt-0.5 accent-primary"
                        />
                        <div>
                          <p className={`font-medium text-sm ${
                            selectedStrategy === strategy.id ? "text-foreground" : "text-muted-foreground"
                          }`}>
                            {strategy.name}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">{strategy.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              {/* Evaluation Criteria */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Evaluation Criteria</CardTitle>
                  <CardDescription>Select metrics to assess model performance</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {evaluationCriteria.map((criteria) => {
                      const isSelected = selectedCriteria.includes(criteria.id)
                      const Icon = criteria.icon
                      return (
                        <div 
                          key={criteria.id}
                          className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                            isSelected ? "border-primary/50 bg-primary/5" : "border-border"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-md flex items-center justify-center ${
                              isSelected ? "bg-primary/10" : "bg-muted"
                            }`}>
                              <Icon className={`w-4 h-4 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                            </div>
                            <div>
                              <p className="font-medium text-sm text-foreground">{criteria.name}</p>
                              <p className="text-xs text-muted-foreground">{criteria.description}</p>
                            </div>
                          </div>
                          <Switch 
                            checked={isSelected}
                            onCheckedChange={() => toggleCriteria(criteria.id)}
                          />
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Run Settings */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Run Settings</CardTitle>
                  <CardDescription>Configure benchmark execution parameters</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
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
                  
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <Label className="text-sm font-medium">Batch run</Label>
                      <p className="text-xs text-muted-foreground">Process all cases in sequence</p>
                    </div>
                    <Switch checked={batchRun} onCheckedChange={setBatchRun} />
                  </div>
                  
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <Label className="text-sm font-medium">Store outputs</Label>
                      <p className="text-xs text-muted-foreground">Save all model responses to database</p>
                    </div>
                    <Switch checked={storeOutputs} onCheckedChange={setStoreOutputs} />
                  </div>
                  
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <Label className="text-sm font-medium">Generate summary report</Label>
                      <p className="text-xs text-muted-foreground">Create PDF report after completion</p>
                    </div>
                    <Switch checked={generateReport} onCheckedChange={setGenerateReport} />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Configuration Summary */}
          <Card className="mt-6 max-w-7xl">
            <CardHeader>
              <CardTitle className="text-base">Configuration Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-6">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Selected Models</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedModels.length > 0 ? (
                      selectedModels.map(id => {
                        const model = models.find(m => m.id === id)
                        return model ? (
                          <Badge key={id} variant="secondary">{model.name}</Badge>
                        ) : null
                      })
                    ) : (
                      <span className="text-sm text-muted-foreground">No models selected</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Prompt Strategy</p>
                  <Badge variant="outline">
                    {promptStrategies.find(s => s.id === selectedStrategy)?.name}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Evaluation Criteria</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedCriteria.length > 0 ? (
                      selectedCriteria.map(id => {
                        const criteria = evaluationCriteria.find(c => c.id === id)
                        return criteria ? (
                          <Badge key={id} variant="secondary">{criteria.name}</Badge>
                        ) : null
                      })
                    ) : (
                      <span className="text-sm text-muted-foreground">No criteria selected</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Run Settings</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{numberOfCases} cases</Badge>
                    {batchRun && <Badge variant="outline">Batch</Badge>}
                    {storeOutputs && <Badge variant="outline">Store outputs</Badge>}
                    {generateReport && <Badge variant="outline">Report</Badge>}
                  </div>
                </div>
              </div>
              
              <div className="flex gap-3 mt-6 pt-4 border-t border-border">
                <Button className="gap-2">
                  <Play className="w-4 h-4" />
                  Start Benchmark
                </Button>
                <Button variant="outline" className="gap-2">
                  <Save className="w-4 h-4" />
                  Save Configuration
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}
