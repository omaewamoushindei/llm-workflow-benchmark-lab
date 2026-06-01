export type LlmProviderId = "openrouter" | "groq"

export type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type ChatCompletionOptions = {
  temperature?: number
  max_tokens?: number
}

export type LlmProviderConfig = {
  id: LlmProviderId
  label: string
  chatCompletionsEndpoint: string
  modelsEndpoint?: string
  requiresBearerAuth: true
}

export type NormalizedProviderModel = {
  id: string
  name: string
  provider: LlmProviderId
  contextLength: number | null
  promptPrice: string | null
  completionPrice: string | null
  isFree: boolean
  supportsStructuredOutput: boolean
  raw: unknown
}

type ProviderModelResponse = {
  data?: unknown[]
  error?: {
    message?: string
  }
}

type ProviderChatResponse = {
  choices?: Array<{
    message?: {
      content?: ProviderMessageContent
    }
  }>
  error?: {
    message?: string
  }
}

type ProviderMessageContent = string | Array<{ type?: string; text?: string }> | undefined

const PROVIDERS: Record<LlmProviderId, LlmProviderConfig> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    chatCompletionsEndpoint: "https://openrouter.ai/api/v1/chat/completions",
    modelsEndpoint: "https://openrouter.ai/api/v1/models",
    requiresBearerAuth: true,
  },
  groq: {
    id: "groq",
    label: "Groq",
    chatCompletionsEndpoint: "https://api.groq.com/openai/v1/chat/completions",
    modelsEndpoint: "https://api.groq.com/openai/v1/models",
    requiresBearerAuth: true,
  },
}

const STATIC_GROQ_MODELS: NormalizedProviderModel[] = [
  {
    id: "llama-3.1-8b-instant",
    name: "Llama 3.1 8B Instant",
    provider: "groq",
    contextLength: 131072,
    promptPrice: null,
    completionPrice: null,
    isFree: false,
    supportsStructuredOutput: true,
    raw: { source: "static_fallback" },
  },
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B Versatile",
    provider: "groq",
    contextLength: 131072,
    promptPrice: null,
    completionPrice: null,
    isFree: false,
    supportsStructuredOutput: true,
    raw: { source: "static_fallback" },
  },
  {
    id: "gemma2-9b-it",
    name: "Gemma2 9B IT",
    provider: "groq",
    contextLength: 8192,
    promptPrice: null,
    completionPrice: null,
    isFree: false,
    supportsStructuredOutput: true,
    raw: { source: "static_fallback" },
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readPrice(value: unknown): string | null {
  if (typeof value === "string") return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function isZeroPrice(value: string | null): boolean {
  if (value === null) return false
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed === 0
}

function readTextContent(content: ProviderMessageContent): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .join("")
  }
  return ""
}

function hasStructuredOutput(raw: Record<string, unknown>): boolean {
  const supported = raw.supported_parameters
  if (!Array.isArray(supported)) return false

  return supported.some((parameter) => {
    if (typeof parameter !== "string") return false
    const normalized = parameter.toLowerCase()
    return (
      normalized.includes("response_format") ||
      normalized.includes("structured_output") ||
      normalized.includes("structured_outputs")
    )
  })
}

function normalizeOpenRouterModel(raw: unknown): NormalizedProviderModel | null {
  if (!isRecord(raw)) return null

  const id = readString(raw.id)
  if (!id) return null

  const pricing = isRecord(raw.pricing) ? raw.pricing : {}
  const promptPrice = readPrice(pricing.prompt)
  const completionPrice = readPrice(pricing.completion)

  return {
    id,
    name: readString(raw.name) || id,
    provider: "openrouter",
    contextLength: readNumber(raw.context_length),
    promptPrice,
    completionPrice,
    isFree: isZeroPrice(promptPrice) && isZeroPrice(completionPrice),
    supportsStructuredOutput: hasStructuredOutput(raw),
    raw,
  }
}

function normalizeGroqModel(raw: unknown): NormalizedProviderModel | null {
  if (!isRecord(raw)) return null

  const id = readString(raw.id)
  if (!id) return null

  const promptPrice = readPrice(raw.promptPrice)
  const completionPrice = readPrice(raw.completionPrice)

  return {
    id,
    name: readString(raw.name) || id,
    provider: "groq",
    contextLength: readNumber(raw.context_window) ?? readNumber(raw.contextLength),
    promptPrice,
    completionPrice,
    isFree: isZeroPrice(promptPrice) && isZeroPrice(completionPrice),
    supportsStructuredOutput: true,
    raw,
  }
}

function getProviderConfig(providerId: LlmProviderId): LlmProviderConfig {
  return PROVIDERS[providerId]
}

export async function callProviderChatCompletion(
  providerId: LlmProviderId,
  apiKey: string,
  modelId: string,
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<string> {
  const provider = getProviderConfig(providerId)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }

  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
    headers["X-OpenRouter-Title"] = "PCT Stewardship Evaluator"
  }

  const response = await fetch(provider.chatCompletionsEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: modelId,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.max_tokens ?? 1000,
      messages,
    }),
  })

  const body = (await response.json().catch(() => null)) as ProviderChatResponse | null

  if (!response.ok) {
    const message = body?.error?.message || `${provider.label} request failed with status ${response.status}`
    throw new Error(message)
  }

  const rawText = readTextContent(body?.choices?.[0]?.message?.content)
  if (!rawText.trim()) {
    throw new Error(`${provider.label} returned an empty response`)
  }

  return rawText
}

export async function fetchProviderModels(
  providerId: LlmProviderId,
  apiKey: string,
): Promise<NormalizedProviderModel[]> {
  const provider = getProviderConfig(providerId)

  if (!provider.modelsEndpoint) {
    return providerId === "groq" ? STATIC_GROQ_MODELS : []
  }

  const response = await fetch(provider.modelsEndpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  })

  const body = (await response.json().catch(() => null)) as ProviderModelResponse | null

  if (!response.ok) {
    if (providerId === "groq") return STATIC_GROQ_MODELS
    const message = body?.error?.message || `${provider.label} models request failed with status ${response.status}`
    throw new Error(message)
  }

  const rawModels = body?.data ?? []
  const models = rawModels
    .map((model) =>
      providerId === "openrouter"
        ? normalizeOpenRouterModel(model)
        : normalizeGroqModel(model),
    )
    .filter((model): model is NormalizedProviderModel => !!model)

  return providerId === "groq" && models.length === 0 ? STATIC_GROQ_MODELS : models
}
