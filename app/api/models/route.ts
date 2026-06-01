import { NextResponse } from 'next/server'

import { fetchProviderModels, type LlmProviderId } from '@/lib/llm-providers'

function isProviderId(value: unknown): value is LlmProviderId {
  return value === 'openrouter' || value === 'groq'
}

export async function POST(request: Request) {
  let providerId: LlmProviderId
  let apiKey: string

  try {
    const body = (await request.json()) as { providerId?: unknown; apiKey?: unknown }
    if (!isProviderId(body.providerId)) {
      return NextResponse.json({ error: 'Unsupported provider', models: [] }, { status: 400 })
    }
    if (typeof body.apiKey !== 'string' || !body.apiKey.trim()) {
      return NextResponse.json({ error: 'Missing API key', models: [] }, { status: 400 })
    }
    providerId = body.providerId
    apiKey = body.apiKey.trim()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', models: [] }, { status: 400 })
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: 'Missing API key', models: [] },
      { status: 500 },
    )
  }

  try {
    const models = await fetchProviderModels(providerId, apiKey)
    return NextResponse.json({ models })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provider models request failed'
    return NextResponse.json(
      {
        error: message,
        models: [],
      },
      { status: 500 },
    )
  }
}
