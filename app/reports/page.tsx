"use client"

import { Sidebar } from "@/components/dashboard/sidebar"
import { Header } from "@/components/dashboard/header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { 
  FileText, 
  Download, 
  Save, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  TrendingUp,
  Shield,
  Brain,
  Activity,
  Award,
  ThumbsUp,
  ThumbsDown,
  AlertOctagon,
  Sparkles
} from "lucide-react"

const configurations = [
  {
    rank: 1,
    name: "GPT-4 + Verification Workflow",
    model: "GPT-4",
    prompt: "Verification Workflow",
    overall: 91.2,
    guideline: 94.5,
    safety: 96.0,
    explainability: 88.3,
    robustness: 86.0,
    recommendation: "Highly Recommended",
    badge: "success"
  },
  {
    rank: 2,
    name: "Claude + Structured Output",
    model: "Claude 3.5",
    prompt: "Structured Output",
    overall: 87.8,
    guideline: 89.2,
    safety: 92.5,
    explainability: 86.7,
    robustness: 82.8,
    recommendation: "Recommended",
    badge: "success"
  },
  {
    rank: 3,
    name: "GPT-4 + Baseline Prompt",
    model: "GPT-4",
    prompt: "Baseline",
    overall: 78.4,
    guideline: 82.1,
    safety: 84.0,
    explainability: 75.2,
    robustness: 72.3,
    recommendation: "Acceptable",
    badge: "warning"
  },
  {
    rank: 4,
    name: "Llama 3 + Chain-of-Thought",
    model: "Llama 3",
    prompt: "Chain-of-Thought",
    overall: 68.9,
    guideline: 71.5,
    safety: 72.0,
    explainability: 68.4,
    robustness: 63.7,
    recommendation: "Not Recommended",
    badge: "destructive"
  }
]

const modelAnalysis = [
  {
    model: "GPT-4",
    strengths: [
      "Excellent guideline adherence with PCT threshold interpretation",
      "Strong safety awareness for immunocompromised patients",
      "Consistent structured output formatting",
      "Good handling of edge cases and ambiguous data"
    ],
    weaknesses: [
      "Occasional overconfidence in recommendations",
      "May suggest unnecessary tests when data is complete",
      "Slightly verbose explanations in some cases"
    ]
  },
  {
    model: "Claude 3.5",
    strengths: [
      "Highly transparent reasoning process",
      "Excellent at acknowledging uncertainty",
      "Strong contextual understanding of clinical notes",
      "Good balance of safety and clinical utility"
    ],
    weaknesses: [
      "Sometimes overly cautious in clear-cut cases",
      "Occasional inconsistency in PCT threshold application",
      "May request additional data unnecessarily"
    ]
  },
  {
    model: "Llama 3",
    strengths: [
      "Fast inference time",
      "Good basic PCT interpretation",
      "Consistent output structure"
    ],
    weaknesses: [
      "Frequent guideline deviations in complex cases",
      "Limited safety awareness for special populations",
      "Prone to hallucinating citation sources",
      "Weak reasoning for edge cases"
    ]
  }
]

const hallucinationPatterns = [
  {
    pattern: "Fabricated Study Citations",
    frequency: "12% of cases",
    severity: "high",
    description: "Model cited non-existent clinical studies or misattributed findings to incorrect sources.",
    affected: ["Llama 3", "GPT-4 (Baseline)"]
  },
  {
    pattern: "Invented PCT Thresholds",
    frequency: "8% of cases",
    severity: "high",
    description: "Model stated PCT cutoff values that do not align with established guidelines (e.g., claiming 0.15 ng/mL as discontinuation threshold).",
    affected: ["Llama 3"]
  },
  {
    pattern: "Assumed Patient History",
    frequency: "15% of cases",
    severity: "medium",
    description: "Model made assumptions about patient history not present in the input data (e.g., assuming prior antibiotic courses).",
    affected: ["Llama 3", "Claude 3.5"]
  },
  {
    pattern: "Misinterpreted Lab Trends",
    frequency: "6% of cases",
    severity: "medium",
    description: "Model described PCT trends that contradicted the actual data provided.",
    affected: ["Llama 3", "GPT-4 (Baseline)"]
  }
]

function ScoreBar({ score, label }: { score: number; label: string }) {
  const getColor = (s: number) => {
    if (s >= 90) return "bg-success"
    if (s >= 80) return "bg-primary"
    if (s >= 70) return "bg-warning"
    return "bg-destructive"
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{score.toFixed(1)}%</span>
      </div>
      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
        <div 
          className={`h-full rounded-full transition-all ${getColor(score)}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  )
}

export default function ReportsPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar activePage="Reports" />
      
      <div className="flex-1 flex flex-col">
        <Header 
          title="Suitability Report" 
          description="LLM Configuration Assessment for PCT-Guided Antibiotic Stewardship"
        />
        
        <main className="flex-1 p-6 overflow-auto">
          {/* Action Buttons */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-muted-foreground">
                Report Generated: April 20, 2026
              </Badge>
              <Badge variant="outline" className="text-muted-foreground">
                48 Cases Evaluated
              </Badge>
              <Badge variant="outline" className="text-muted-foreground">
                4 Configurations Tested
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <FileText className="h-4 w-4 mr-2" />
                Export PDF
              </Button>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
              <Button size="sm">
                <Save className="h-4 w-4 mr-2" />
                Save Report
              </Button>
            </div>
          </div>

          {/* Executive Summary */}
          <Card className="mb-6 border-l-4 border-l-primary">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Executive Summary</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-foreground leading-relaxed">
                This evaluation assessed four LLM configurations for suitability in PCT-guided antibiotic 
                stewardship decision support. Testing covered 48 clinical cases spanning community-acquired 
                pneumonia, sepsis, and respiratory infections with varying complexity levels.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                <div className="flex items-start gap-3 p-3 bg-success/10 rounded-lg border border-success/20">
                  <CheckCircle2 className="h-5 w-5 text-success mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Top Performer</p>
                    <p className="text-sm text-muted-foreground">GPT-4 + Verification Workflow achieved 91.2% overall suitability</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-warning/10 rounded-lg border border-warning/20">
                  <AlertTriangle className="h-5 w-5 text-warning mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Safety Concern</p>
                    <p className="text-sm text-muted-foreground">Llama 3 showed 28% higher safety flag rate than top performer</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-primary/10 rounded-lg border border-primary/20">
                  <Brain className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Key Finding</p>
                    <p className="text-sm text-muted-foreground">Verification workflow prompts reduced hallucinations by 64%</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Configuration Rankings */}
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Configuration Rankings</CardTitle>
              </div>
              <CardDescription>
                Overall suitability scores based on weighted evaluation criteria
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {configurations.map((config) => (
                  <div 
                    key={config.rank}
                    className={`p-4 rounded-lg border ${
                      config.rank === 1 ? "bg-success/5 border-success/30" : "bg-card"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          config.rank === 1 ? "bg-success text-success-foreground" :
                          config.rank === 2 ? "bg-primary text-primary-foreground" :
                          config.rank === 3 ? "bg-warning text-warning-foreground" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {config.rank}
                        </div>
                        <div>
                          <h4 className="font-semibold">{config.name}</h4>
                          <p className="text-sm text-muted-foreground">
                            {config.model} with {config.prompt} prompt strategy
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold">{config.overall}%</div>
                        <Badge 
                          variant={config.badge as "default" | "secondary" | "destructive" | "outline"}
                          className={
                            config.badge === "success" ? "bg-success text-success-foreground" :
                            config.badge === "warning" ? "bg-warning text-warning-foreground" :
                            ""
                          }
                        >
                          {config.recommendation}
                        </Badge>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <ScoreBar score={config.guideline} label="Guideline Alignment" />
                      <ScoreBar score={config.safety} label="Safety" />
                      <ScoreBar score={config.explainability} label="Explainability" />
                      <ScoreBar score={config.robustness} label="Robustness" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Score Breakdown Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm font-medium">Guideline Alignment</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold mb-1">88.3%</div>
                <p className="text-xs text-muted-foreground mb-3">Average across all configs</p>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span>Best: GPT-4 + Verification</span>
                    <span className="font-medium">94.5%</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Worst: Llama 3 + CoT</span>
                    <span>71.5%</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-success" />
                  <CardTitle className="text-sm font-medium">Safety Score</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold mb-1">86.1%</div>
                <p className="text-xs text-muted-foreground mb-3">Average across all configs</p>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span>Best: GPT-4 + Verification</span>
                    <span className="font-medium">96.0%</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Worst: Llama 3 + CoT</span>
                    <span>72.0%</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-accent" />
                  <CardTitle className="text-sm font-medium">Explainability</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold mb-1">79.7%</div>
                <p className="text-xs text-muted-foreground mb-3">Average across all configs</p>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span>Best: GPT-4 + Verification</span>
                    <span className="font-medium">88.3%</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Worst: Llama 3 + CoT</span>
                    <span>68.4%</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-chart-4" />
                  <CardTitle className="text-sm font-medium">Robustness</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold mb-1">76.2%</div>
                <p className="text-xs text-muted-foreground mb-3">Average across all configs</p>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span>Best: GPT-4 + Verification</span>
                    <span className="font-medium">86.0%</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Worst: Llama 3 + CoT</span>
                    <span>63.7%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Strengths & Weaknesses */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">Strengths & Weaknesses by Model</CardTitle>
              <CardDescription>
                Detailed analysis of each model&apos;s performance characteristics
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {modelAnalysis.map((model) => (
                  <div key={model.model} className="space-y-4">
                    <h4 className="font-semibold text-base border-b pb-2">{model.model}</h4>
                    
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-success">
                        <ThumbsUp className="h-4 w-4" />
                        Strengths
                      </div>
                      <ul className="space-y-1.5">
                        {model.strengths.map((strength, i) => (
                          <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                            <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
                            {strength}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                        <ThumbsDown className="h-4 w-4" />
                        Weaknesses
                      </div>
                      <ul className="space-y-1.5">
                        {model.weaknesses.map((weakness, i) => (
                          <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                            <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                            {weakness}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Hallucination Patterns */}
          <Card className="mb-6 border-destructive/30">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertOctagon className="h-5 w-5 text-destructive" />
                <CardTitle className="text-lg">Observed Hallucination Patterns</CardTitle>
              </div>
              <CardDescription>
                Critical accuracy issues identified during evaluation
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {hallucinationPatterns.map((pattern, index) => (
                  <div 
                    key={index}
                    className={`p-4 rounded-lg border ${
                      pattern.severity === "high" 
                        ? "bg-destructive/5 border-destructive/20" 
                        : "bg-warning/5 border-warning/20"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant={pattern.severity === "high" ? "destructive" : "outline"}
                          className={pattern.severity === "medium" ? "bg-warning text-warning-foreground border-warning" : ""}
                        >
                          {pattern.severity === "high" ? "High Severity" : "Medium Severity"}
                        </Badge>
                        <span className="font-semibold">{pattern.pattern}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">{pattern.frequency}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{pattern.description}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Affected models:</span>
                      {pattern.affected.map((model) => (
                        <Badge key={model} variant="outline" className="text-xs">
                          {model}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Final Recommendation */}
          <Card className="border-2 border-primary/30 bg-primary/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Final Recommendation</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-card rounded-lg border">
                <div className="w-12 h-12 rounded-full bg-success flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-success-foreground" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-lg">GPT-4 with Verification Workflow</h4>
                  <p className="text-muted-foreground">
                    Recommended for clinical deployment in PCT-guided antibiotic stewardship
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-success">91.2%</div>
                  <p className="text-sm text-muted-foreground">Overall Score</p>
                </div>
              </div>

              <div className="prose prose-sm max-w-none text-muted-foreground">
                <p>
                  Based on comprehensive evaluation across 48 clinical cases, <strong className="text-foreground">GPT-4 with Verification 
                  Workflow prompting</strong> demonstrates the highest suitability for PCT-guided antibiotic stewardship 
                  decision support. This configuration achieved superior performance in all four evaluation dimensions:
                </p>
                <ul className="mt-2 space-y-1">
                  <li><strong className="text-foreground">Guideline Alignment (94.5%):</strong> Consistent adherence to PCT threshold guidelines with appropriate interpretation of values</li>
                  <li><strong className="text-foreground">Safety (96.0%):</strong> Excellent recognition of high-risk populations and contraindications</li>
                  <li><strong className="text-foreground">Explainability (88.3%):</strong> Clear, traceable reasoning that supports clinical decision-making</li>
                  <li><strong className="text-foreground">Robustness (86.0%):</strong> Stable performance across case complexity levels and edge cases</li>
                </ul>
                <p className="mt-4">
                  The verification workflow significantly reduces hallucination risk compared to baseline prompting, making 
                  it the most reliable choice for clinical environments where accuracy is critical.
                </p>
              </div>

              <div className="flex items-center gap-4 pt-4 border-t">
                <Button>
                  <FileText className="h-4 w-4 mr-2" />
                  Export Full Report
                </Button>
                <Button variant="outline">
                  <Download className="h-4 w-4 mr-2" />
                  Download Raw Data
                </Button>
                <Button variant="outline">
                  <Save className="h-4 w-4 mr-2" />
                  Save to Library
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}
