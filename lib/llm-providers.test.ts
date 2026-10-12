import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fetchProviderModels,
  getMockProviderModels,
  reconcileSelectedProviderModels,
} from './llm-providers'

test('mock provider catalogs contain only explicit synthetic models', () => {
  for (const providerId of ['groq', 'openrouter'] as const) {
    const models = getMockProviderModels(providerId)
    assert.equal(models.length, 3)
    assert.ok(models.every((model) => model.provider === providerId))
    assert.ok(models.every((model) => model.id.startsWith('mock/')))
    assert.ok(models.every((model) => model.raw && (model.raw as { source?: string }).source === 'mock_mode'))
  }
})

test('provider catalog authentication failures are surfaced instead of returning stale fallbacks', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })

  try {
    await assert.rejects(fetchProviderModels('groq', 'fake-test-key'), /Invalid API key/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('refreshed catalogs remove retired selections before enforcing the selection limit', () => {
  const selected = ['retired-a', 'retired-b', 'retired-c']
  const available = [{ id: 'current-a' }, { id: 'current-b' }]

  assert.deepEqual(reconcileSelectedProviderModels(selected, available), [])
  assert.deepEqual(
    reconcileSelectedProviderModels(['current-a', 'retired-a', 'current-a', 'current-b'], available),
    ['current-a', 'current-b'],
  )
})
