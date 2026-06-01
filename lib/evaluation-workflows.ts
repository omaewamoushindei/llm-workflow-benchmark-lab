import type { EvaluationWorkflow } from "./types"

export const DEFAULT_EVALUATION_WORKFLOWS: EvaluationWorkflow[] = [
  {
    id: "default-raw-llm-baseline",
    name: "Raw LLM Baseline",
    description: "Single baseline LLM call against case data.",
    isDefault: true,
    steps: [
      {
        id: "baseline-llm",
        name: "Baseline LLM call",
        stepType: "llm_call",
        promptTemplateId: "default-baseline-pct",
        inputSource: "case_data",
      },
    ],
  },
  {
    id: "default-structured-prompt",
    name: "Structured Prompt",
    description: "Single structured JSON LLM call.",
    isDefault: true,
    steps: [
      {
        id: "structured-llm",
        name: "Structured JSON call",
        stepType: "llm_call",
        promptTemplateId: "default-structured-pct-json",
        inputSource: "case_data",
      },
    ],
  },
  {
    id: "default-verification-workflow",
    name: "Verification Workflow",
    description: "Primary LLM output followed by a verification step.",
    isDefault: true,
    steps: [
      {
        id: "verification-primary",
        name: "Primary reasoning",
        stepType: "llm_call",
        promptTemplateId: "default-structured-pct-json",
        inputSource: "case_data",
      },
      {
        id: "verification-review",
        name: "Verifier review",
        stepType: "verification",
        promptTemplateId: "default-verification-checklist",
        inputSource: "previous_step",
      },
    ],
  },
  {
    id: "default-deterministic-precheck-explanation",
    name: "Deterministic Precheck + LLM Explanation",
    description: "Backend deterministic checks followed by an LLM explanation.",
    isDefault: true,
    steps: [
      {
        id: "deterministic-precheck",
        name: "Deterministic precheck",
        stepType: "deterministic_precheck",
        inputSource: "reference_checks",
      },
      {
        id: "deterministic-explanation",
        name: "LLM explanation",
        stepType: "llm_call",
        promptTemplateId: "default-deterministic-precheck-explanation",
        inputSource: "combined",
      },
    ],
  },
  {
    id: "default-a1-a4-pct-pipeline",
    name: "A1-A4 PCT Pipeline",
    description: "Linear intake, reasoning, kinetic analysis, and final report workflow.",
    isDefault: true,
    steps: [
      {
        id: "a1-intake-validation",
        name: "Intake & validation",
        stepType: "llm_call",
        promptTemplateId: "default-structured-pct-json",
        inputSource: "case_data",
      },
      {
        id: "a2-clinical-reasoning",
        name: "Clinical reasoning",
        stepType: "llm_call",
        promptTemplateId: "default-structured-pct-json",
        inputSource: "previous_step",
      },
      {
        id: "a3-kinetic-analysis",
        name: "Kinetic analysis",
        stepType: "verification",
        promptTemplateId: "default-verification-checklist",
        inputSource: "combined",
      },
      {
        id: "a4-final-report",
        name: "Final report",
        stepType: "final_report",
        promptTemplateId: "default-verification-checklist",
        inputSource: "combined",
      },
    ],
  },
]
