"use client"

import { Sidebar } from "@/components/dashboard/sidebar"
import { Header } from "@/components/dashboard/header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { 
  Target, 
  ShieldAlert, 
  Lightbulb, 
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  TrendingUp,
  TrendingDown
} from "lucide-react"

const configurations = [
  {
    id: "config-a",
    name: "Config A",
    model: "GPT-4",
    prompt: "Baseline Prompt",
    recommendation: "Continue antibiotics for 5 more days",
    reasoning: "PCT level of 0.8 ng/mL suggests ongoing bacterial infection. Clinical symptoms persist including fever and elevated WBC. Standard 7-day course recommended per institutional protocol.",
    pctInterpretation: "Elevated PCT (0.8 ng/mL) indicates likely bacterial infection requiring continued antibiotic therapy.",
    safetyFlag: "safe",
    alignmentScore: 78,
    explainabilityScore: 72,
  },
  {
    id: "config-b",
    name: "Config B",
    model: "Claude",
    prompt: "Structured Prompt",
    recommendation: "Consider de-escalation to oral antibiotics",
    reasoning: "PCT trending downward from 2.1 to 0.8 ng/mL over 48 hours suggests treatment response. Patient clinically improving with resolution of fever. Guidelines support step-down therapy when PCT decreases >80% from peak.",
    pctInterpretation: "Decreasing PCT trend (62% reduction) with clinical improvement supports antibiotic de-escalation per stewardship guidelines.",
    safetyFlag: "safe",
    alignmentScore: 92,
    explainabilityScore: 88,
  },
  {
    id: "config-c",
    name: "Config C",
    model: "GPT-4",
    prompt: "Verification Workflow",
    recommendation: "Discontinue antibiotics within 24-48 hours",
    reasoning: "PCT of 0.8 ng/mL with downward trend meets discontinuation criteria. Multi-step verification confirmed: (1) No new infection signs, (2) Hemodynamic stability, (3) Oral tolerance present, (4) PCT below continuation threshold.",
    pctInterpretation: "PCT 0.8 ng/mL with >50% decline from peak. Verification steps confirm safe discontinuation window per evidence-based protocol.",
    safetyFlag: "caution",
    alignmentScore: 95,
    explainabilityScore: 94,
  },
]

const warnings = [
  {
    config: "Config A",
    type: "Guideline Deviation",
    message: "Recommendation does not account for PCT trend analysis, which is a key factor in stewardship guidelines.",
    severity: "medium",
  },
  {
    config: "Config A",
    type: "Overtreatment Risk",
    message: "Extended antibiotic duration without considering de-escalation criteria may contribute to resistance.",
    severity: "high",
  },
]

const limitations = [
  {
    config: "Config A",
    type: "Weak Reasoning",
    description: "Does not reference specific guideline thresholds or cite evidence for duration recommendation.",
  },
  {
    config: "Config A",
    type: "Missing Context",
    description: "Fails to incorporate PCT trend analysis which is critical for stewardship decisions.",
  },
  {
    config: "Config C",
    type: "Potential Hallucination",
    description: "References 'institutional protocol v3.2' which was not provided in the input context.",
  },
]

export default function BenchmarkResultsPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar activePage="Benchmark Results" />
      
      <div className="flex-1 flex flex-col">
        <Header 
          title="Benchmark Results" 
          description="Comparative analysis of LLM configurations for PCT-guided stewardship"
        />
        
        <main className="flex-1 p-6 overflow-auto">
          {/* Summary Metrics Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Guideline Alignment</p>
                    <p className="text-2xl font-bold text-foreground">88.3%</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <TrendingUp className="h-3 w-3 text-success" />
                      <span className="text-success">+4.2%</span> vs baseline
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
                    <p className="text-sm font-medium text-muted-foreground">Safety Risk Flags</p>
                    <p className="text-2xl font-bold text-foreground">2</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <TrendingDown className="h-3 w-3 text-destructive" />
                      <span className="text-destructive">1 high severity</span>
                    </p>
                  </div>
                  <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                    <ShieldAlert className="h-6 w-6 text-destructive" />
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Explainability Rating</p>
                    <p className="text-2xl font-bold text-foreground">84.7%</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <TrendingUp className="h-3 w-3 text-success" />
                      <span className="text-success">+12.1%</span> with structured
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
                    <p className="text-sm font-medium text-muted-foreground">Robustness Score</p>
                    <p className="text-2xl font-bold text-foreground">76.5%</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Info className="h-3 w-3 text-muted-foreground" />
                      Across 24 test cases
                    </p>
                  </div>
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Shield className="h-6 w-6 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Configuration Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {configurations.map((config) => (
              <Card key={config.id} className={config.alignmentScore >= 90 ? "ring-2 ring-success/30" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">{config.name}</CardTitle>
                      <CardDescription>{config.model} + {config.prompt}</CardDescription>
                    </div>
                    {config.safetyFlag === "safe" ? (
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
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Recommendation</p>
                    <p className="text-sm font-medium text-foreground">{config.recommendation}</p>
                  </div>
                  
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Reasoning Summary</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{config.reasoning}</p>
                  </div>
                  
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">PCT Interpretation</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{config.pctInterpretation}</p>
                  </div>
                  
                  <div className="pt-3 border-t border-border space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Alignment Score</span>
                        <span className="text-xs font-medium">{config.alignmentScore}%</span>
                      </div>
                      <Progress 
                        value={config.alignmentScore} 
                        className="h-2"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Explainability</span>
                        <span className="text-xs font-medium">{config.explainabilityScore}%</span>
                      </div>
                      <Progress 
                        value={config.explainabilityScore} 
                        className="h-2"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Warnings Panel and Score Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  Safety Warnings
                </CardTitle>
                <CardDescription>Flagged issues requiring clinical review</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {warnings.map((warning, index) => (
                  <div 
                    key={index} 
                    className={`p-3 rounded-lg border ${
                      warning.severity === "high" 
                        ? "bg-destructive/5 border-destructive/20" 
                        : "bg-warning/5 border-warning/20"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {warning.severity === "high" ? (
                        <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-warning-foreground mt-0.5 shrink-0" />
                      )}
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-muted-foreground">{warning.config}</span>
                          <Badge variant="outline" className="text-xs h-5">
                            {warning.type}
                          </Badge>
                        </div>
                        <p className="text-sm text-foreground">{warning.message}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Score Breakdown by Criteria</CardTitle>
                <CardDescription>Comparative performance across evaluation dimensions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    { label: "Guideline Reference", configA: 65, configB: 90, configC: 95 },
                    { label: "PCT Threshold Accuracy", configA: 80, configB: 92, configC: 94 },
                    { label: "Clinical Context Use", configA: 72, configB: 88, configC: 91 },
                    { label: "Reasoning Transparency", configA: 68, configB: 85, configC: 96 },
                    { label: "Safety Consideration", configA: 85, configB: 95, configC: 93 },
                  ].map((item, index) => (
                    <div key={index}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-foreground">{item.label}</span>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-muted-foreground">A: {item.configA}</span>
                          <span className="text-muted-foreground">B: {item.configB}</span>
                          <span className="font-medium text-primary">C: {item.configC}</span>
                        </div>
                      </div>
                      <div className="flex gap-1 h-2">
                        <div 
                          className="bg-muted-foreground/30 rounded-l" 
                          style={{ width: `${item.configA}%` }}
                        />
                        <div 
                          className="bg-accent/50" 
                          style={{ width: `${item.configB - item.configA}%` }}
                        />
                        <div 
                          className="bg-primary rounded-r" 
                          style={{ width: `${item.configC - item.configB}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-muted-foreground/30" />
                    <span className="text-xs text-muted-foreground">Config A</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-accent/50" />
                    <span className="text-xs text-muted-foreground">Config B</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-primary" />
                    <span className="text-xs text-muted-foreground">Config C</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Model Suitability Summary and Observed Limitations */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-primary/5 border-primary/20">
              <CardHeader>
                <CardTitle className="text-base">Model Suitability Summary</CardTitle>
                <CardDescription>Recommendation based on evaluation criteria</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 bg-background rounded-lg border border-border">
                    <CheckCircle2 className="h-5 w-5 text-success mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-foreground mb-1">Recommended: Config C (GPT-4 + Verification Workflow)</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Highest alignment with clinical guidelines (95%) and explainability (94%). 
                        The verification workflow ensures multi-step validation before final recommendation, 
                        reducing risk of unsafe outputs.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 p-4 bg-background rounded-lg border border-border">
                    <Info className="h-5 w-5 text-accent mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-foreground mb-1">Alternative: Config B (Claude + Structured Prompt)</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Strong performance (92% alignment) with lower computational overhead. 
                        Suitable for high-volume screening with human oversight.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 p-4 bg-background rounded-lg border border-border">
                    <XCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-foreground mb-1">Not Recommended: Config A (GPT-4 + Baseline)</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Insufficient guideline alignment (78%) and multiple safety flags. 
                        Requires significant prompt engineering before clinical deployment.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Observed Limitations</CardTitle>
                <CardDescription>Issues identified during evaluation requiring attention</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {limitations.map((limitation, index) => (
                    <div key={index} className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                      <Badge variant="outline" className="shrink-0 mt-0.5">
                        {limitation.config}
                      </Badge>
                      <div>
                        <p className="text-sm font-medium text-foreground">{limitation.type}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">{limitation.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    <strong>Note:</strong> All limitations should be reviewed by clinical domain experts 
                    before finalizing model selection. Hallucination detection is based on input context 
                    comparison and may require additional validation.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  )
}
