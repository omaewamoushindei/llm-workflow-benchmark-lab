import { NextResponse } from 'next/server'

import { callProviderChatCompletion } from '@/lib/llm-providers'

type FailureReason =
  | 'needs_credits'
  | 'provider_error'
  | 'rate_limited'
  | 'no_endpoint'
  | 'unknown'

type ModelTestResult = {
  modelId: string
  status: 'available' | 'failed'
  error?: string
  failureReason?: FailureReason
}

function classifyFailure(status: number | null, message: string): FailureReason {
  const normalized = message.toLowerCase()

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

async function testModel(modelId: string, apiKey: string): Promise<ModelTestResult> {
  try {
    await callProviderChatCompletion(
      'openrouter',
      apiKey,
      modelId,
      [{ role: 'user', content: 'Return JSON: {"ok": true}' }],
      { temperature: 0, max_tokens: 20 },
    )

    return {
      modelId,
      status: 'available',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown model test error'
    return {
      modelId,
      status: 'failed',
      error: message,
      failureReason: classifyFailure(null, message),
    }
  }
}

export async function POST(request: Request) {
  let modelIds: string[] = []
  let byokApiKey: string | null = null

  try {
    const body = (await request.json()) as { modelIds?: unknown; apiKey?: unknown }
    modelIds = parseModelIds(body.modelIds)
    byokApiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : null
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', results: [] }, { status: 400 })
  }

  const apiKey = byokApiKey || process.env.OPENROUTER_API_KEY?.trim()

  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY is not configured', results: [] },
      { status: 500 },
    )
  }

  const settled = await Promise.allSettled(modelIds.map((modelId) => testModel(modelId, apiKey)))

  const results: ModelTestResult[] = settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value

    const message = result.reason instanceof Error ? result.reason.message : 'Unknown model test error'
    return {
      modelId: modelIds[index],
      status: 'failed',
      error: message,
      failureReason: classifyFailure(null, message),
    }
  })

  return NextResponse.json({ results })
}
