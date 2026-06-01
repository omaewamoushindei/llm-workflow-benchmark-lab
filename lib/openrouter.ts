import { callProviderChatCompletion } from "./llm-providers"

export type PromptStrategyId = "baseline" | "structured" | "verification"

export interface OpenRouterLlmConfig {
  configId: string
  modelLabel: string
  modelId: string
  promptStrategy: PromptStrategyId
}

// Verify model IDs in OpenRouter before relying on them in production.
// Default fallbacks should stay on free OpenRouter routes to avoid credit-gated MVP failures.
export const OPENROUTER_LLM_CONFIGS: OpenRouterLlmConfig[] = [
  {
    configId: "meta-llama-llama-3.2-3b-instruct-free_baseline",
    modelLabel: "Llama 3.2 3B Instruct Free",
    modelId: "meta-llama/llama-3.2-3b-instruct:free",
    promptStrategy: "baseline",
  },
  {
    configId: "google-gemma-3-4b-it-free_structured",
    modelLabel: "Gemma 3 4B IT Free",
    modelId: "google/gemma-3-4b-it:free",
    promptStrategy: "structured",
  },
  {
    configId: "mistralai-mistral-7b-instruct-free_verification",
    modelLabel: "Mistral 7B Instruct Free",
    modelId: "mistralai/mistral-7b-instruct:free",
    promptStrategy: "verification",
  },
]

export async function callOpenRouter(args: {
  modelId: string
  prompt: string
  apiKey: string
}): Promise<string> {
  return callProviderChatCompletion(
    "openrouter",
    args.apiKey,
    args.modelId,
    [{ role: "user", content: args.prompt }],
    { temperature: 0.1, max_tokens: 1000 },
  )
}
