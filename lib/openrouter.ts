import { callProviderChatCompletion } from "./llm-providers"

export type PromptStrategyId = "baseline" | "structured" | "verification"

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
