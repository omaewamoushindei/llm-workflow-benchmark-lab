import { NextResponse } from 'next/server'

import { callProviderChatCompletion, type LlmProviderId } from '@/lib/llm-providers'

type FailureReason =
  | 'needs_credits'
  | 'provider_error'
  | 'rate_limited'
  | 'no_endpoint'
  | 'invalid_key'
  | 'model_not_found'
  | 'unknown'

type ModelTestResult = {
  ok: boolean
  success: boolean
  providerId: LlmProviderId
  modelId: string
  status: 'available' | 'failed'
  latencyMs: number
  error?: string
  failureReason?: FailureReason
}

function classifyFailure(status: number | null, message: string): FailureReason {
  const normalized = message.toLowerCase()

  if (
    status === 401 ||
    status === 403 ||
    normalized.includes('invalid api key') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('authentication')
  ) {
    return 'invalid_key'
  }

  if (
    status === 402 ||
    normalized.includes('insufficient credits') ||
    normalized.includes('credits') ||
    normalized.includes('requires payment')
  ) {
    return 'needs_credits'
  }

  if (status === 429 || normalized.includes('rate limit') || normalized.includes('rate_limited')) {
    return 'rate_limited'
  }

  if (
    status === 404 ||
    normalized.includes('model not found') ||
    normalized.includes('model_not_found') ||
    normalized.includes('does not exist')
  ) {
    return 'model_not_found'
  }

  if (
    normalized.includes('no endpoints found') ||
    normalized.includes('no endpoint') ||
    normalized.includes('not available') ||
    normalized.includes('unavailable')
  ) {
    return 'no_endpoint'
  }

  if (
    normalized.includes('provider returned error') ||
    normalized.includes('provider error') ||
    normalized.includes('upstream')
  ) {
    return 'provider_error'
  }

  return 'unknown'
}

function isProviderId(value: unknown): value is LlmProviderId {
  return value === 'openrouter' || value === 'groq'
}

function parseStatusFromMessage(message: string): number | null {
  const match = message.match(/\bstatus\s+(\d{3})\b/i) ?? message.match(/\b(\d{3})\b/)
  if (!match) return null

  const status = Number(match[1])
  return Number.isFinite(status) ? status : null
}

function parseModelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .filter((modelId): modelId is string => typeof modelId === 'string')
        .map((modelId) => modelId.trim())
        .filter(Boolean),
    ),
  ).slice(0, 3)
}

function getEnvApiKey(providerId: LlmProviderId): string | null {
  const value =
    providerId === 'groq'
      ? process.env.GROQ_API_KEY?.trim()
      : process.env.OPENROUTER_API_KEY?.trim()

  return value || null
}

async function testModel(
  providerId: LlmProviderId,
  modelId: string,
  apiKey: string,
): Promise<ModelTestResult> {
  const startedAt = Date.now()

  try {
    await callProviderChatCompletion(
      providerId,
      apiKey,
      modelId,
      [{ role: 'user', content: 'Return JSON: {"ok": true}' }],
      { temperature: 0, max_tokens: 20 },
    )

    return {
      ok: true,
      success: true,
      providerId,
      modelId,
      status: 'available',
      latencyMs: Date.now() - startedAt,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown model test error'
    const status = parseStatusFromMessage(message)
    return {
      ok: false,
      success: false,
      providerId,
      modelId,
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      error: message,
      failureReason: classifyFailure(status, message),
    }
  }
}

export async function POST(request: Request) {
  let modelIds: string[] = []
  let byokApiKey: string | null = null
  let providerId: LlmProviderId = 'openrouter'

  try {
    const body = (await request.json()) as {
      modelIds?: unknown
      apiKey?: unknown
      providerId?: unknown
      provider?: unknown
    }
    modelIds = parseModelIds(body.modelIds)
    const requestedProvider = body.providerId ?? body.provider
    if (requestedProvider !== undefined) {
      if (!isProviderId(requestedProvider)) {
        return NextResponse.json(
          { ok: false, success: false, error: 'Unsupported provider', results: [] },
          { status: 400 },
        )
      }
      providerId = requestedProvider
    }
    byokApiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : null
  } catch {
    return NextResponse.json(
      { ok: false, success: false, error: 'Invalid JSON body', results: [] },
      { status: 400 },
    )
  }

  if (modelIds.length === 0) {
    return NextResponse.json(
      { ok: false, success: false, providerId, error: 'At least one modelId is required', results: [] },
      { status: 400 },
    )
  }

  if (process.env.USE_MOCK_LLM === 'true') {
    const results: ModelTestResult[] = modelIds.map((modelId) => ({
      ok: true,
      success: true,
      providerId,
      modelId,
      status: 'available',
      latencyMs: 0,
    }))

    return NextResponse.json({ ok: true, success: true, providerId, results })
  }

  const apiKey = byokApiKey || getEnvApiKey(providerId)

  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        providerId,
        error: `Missing API key for ${providerId === 'groq' ? 'Groq' : 'OpenRouter'}`,
        results: [],
      },
      { status: 400 },
    )
  }

  const settled = await Promise.allSettled(
    modelIds.map((modelId) => testModel(providerId, modelId, apiKey)),
  )

  const results: ModelTestResult[] = settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value

    const message = result.reason instanceof Error ? result.reason.message : 'Unknown model test error'
    const status = parseStatusFromMessage(message)
    return {
      ok: false,
      success: false,
      providerId,
      modelId: modelIds[index],
      status: 'failed',
      latencyMs: 0,
      error: message,
      failureReason: classifyFailure(status, message),
    }
  })

  const ok = results.every((result) => result.status === 'available')
  return NextResponse.json({ ok, success: ok, providerId, results })
}
