import type { PromptTemplate } from "./types"

export const DEFAULT_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "default-baseline-pct",
    name: "Baseline PCT prompt",
    description: "Concise clinical benchmark prompt with minimal structure.",
    expectedOutputSchema: "pct_json",
    isDefault: true,
    updatedAt: "2026-05-30T00:00:00.000Z",
    text: [
      "Use a concise clinical evaluation style.",
      "Identify the recommendation, PCT interpretation, missing information, and major safety concerns.",
      "Keep reasoning brief.",
    ].join("\n"),
  },
  {
    id: "default-structured-pct-json",
    name: "Structured PCT JSON prompt",
    description: "Explicit criterion-by-criterion PCT evaluation with JSON output.",
    expectedOutputSchema: "pct_json",
    isDefault: true,
    updatedAt: "2026-05-30T00:00:00.000Z",
    text: [
      "Use the schema exactly and evaluate each criterion explicitly.",
      "Separately state whether the PCT absolute threshold criterion is met.",
      "Separately state whether the PCT decline criterion (>80% decline from peak) is met.",
      "Separately state whether the clinical improvement condition is met.",
      "Check clinical improvement before recommending consider_discontinuation.",
      "List missing critical data in missing_information.",
      "List exclusion or caution conditions in safety_warnings.",
    ].join("\n"),
  },
  {
    id: "default-verification-checklist",
    name: "Verification checklist prompt",
    description: "Checklist-style verification before final JSON output.",
    expectedOutputSchema: "verification_json",
    isDefault: true,
    updatedAt: "2026-05-30T00:00:00.000Z",
    text: [
      "Before finalizing the JSON, verify these checklist items internally and summarize the result:",
      "1. Infection context and applicable threshold.",
      "2. PCT absolute threshold criterion: current PCT compared with the threshold.",
      "3. PCT decline criterion: decline from peak compared with the greater-than-80% criterion.",
      "4. Clinical improvement status.",
      "5. Exclusion or caution conditions requiring clinical review.",
      "6. Missing information that limits confidence.",
    ].join("\n"),
  },
  {
    id: "default-deterministic-precheck-explanation",
    name: "Deterministic precheck explanation prompt",
    description: "Tool-assisted explanation prompt for backend-computed PCT rule checks.",
    expectedOutputSchema: "pct_json",
    isDefault: true,
    updatedAt: "2026-05-30T00:00:00.000Z",
    text: [
      "This is a tool-assisted deterministic_precheck_explanation workflow.",
      "Do not present the output as raw model reasoning.",
      "Explain the backend-computed PCT rule result faithfully.",
      "Use the supplied deterministic checks and return only the required JSON schema.",
    ].join("\n"),
  },
]

export function getDefaultPromptTemplate(id: string): PromptTemplate | undefined {
  return DEFAULT_PROMPT_TEMPLATES.find((template) => template.id === id)
}
