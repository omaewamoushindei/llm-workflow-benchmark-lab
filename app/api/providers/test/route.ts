import { NextResponse } from 'next/server'

type ProviderId = 'openrouter' | 'groq'

function isProviderId(value: unknown): value is ProviderId {
  return value === 'openrouter' || value === 'groq'
}

async function testProviderConnection(provider: ProviderId, apiKey: string): Promise<Response> {
  if (provider === 'openrouter') {
    return fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })
  }

  return fetch('https://api.groq.com/openai/v1/models', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })
}

export async function POST(request: Request) {
  let provider: unknown
  let apiKey: unknown

  try {
    const body = (await request.json()) as { provider?: unknown; apiKey?: unknown }
    provider = body.provider
    apiKey = body.apiKey
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isProviderId(provider)) {
    return NextResponse.json({ ok: false, error: 'Unsupported provider' }, { status: 400 })
  }

  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return NextResponse.json({ ok: false, error: 'Missing API key' }, { status: 400 })
  }

  try {
    const response = await testProviderConnection(provider, apiKey.trim())

    if (!response.ok) {
      return NextResponse.json(
        { ok: false, error: `Connection test failed with status ${response.status}` },
        { status: 200 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Connection test failed' }, { status: 200 })
  }
}
