import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CloudBenchmarkRunError,
  loadBenchmarkRunFromCloud,
  saveBenchmarkRunToCloud,
} from './cloud-benchmark-runs'
import {
  buildWorkspaceImportPreview,
  createWorkspaceExport,
  type BenchmarkRunHistoryEntry,
} from './workspace-sharing'

const API_URL = 'https://cloud.example.test'
const RUN_ID = '3bc956b2-0386-4daf-b980-7c4669fd19d9'
const HASH = 'a'.repeat(64)

function buildArtifact(completed = 1): BenchmarkRunHistoryEntry {
  const aggregate = { completed }
  const caseResult = {
    caseId: 'synthetic-cloud-case',
    title: 'Synthetic cloud test case',
    caseData: {},
    referenceDecision: {},
    referenceChecks: {},
    results: [{ configId: 'synthetic-config', status: 'success' }],
  }

  return {
    schemaVersion: '1.0',
    scoringVersion: '1.0',
    appName: 'LLM Workflow Benchmark Lab',
    batchId: 'synthetic-cloud-batch',
    createdAt: '2026-08-15T00:00:00.000Z',
    providerId: 'groq',
    aggregate,
    cases: [caseResult],
    rawBatch: {
      batchId: 'synthetic-cloud-batch',
      createdAt: '2026-08-15T00:00:00.000Z',
      providerId: 'groq',
      aggregate,
      cases: [caseResult],
    },
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('save sends only runId and the completed artifact, then returns typed metadata', async () => {
  const artifact = buildArtifact()
  let requestBody: Record<string, unknown> | undefined
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), `${API_URL}/benchmark-runs`)
    assert.equal(init?.method, 'POST')
    assert.equal(init?.credentials, 'omit')
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return jsonResponse(201, {
      runId: RUN_ID,
      created: true,
      contentSha256: HASH,
      artifactByteSize: 512,
    })
  }) as typeof fetch

  const result = await saveBenchmarkRunToCloud(artifact, {
    apiUrl: API_URL,
    fetchImpl,
    randomUUID: () => RUN_ID,
  })

  assert.deepEqual(Object.keys(requestBody ?? {}).sort(), ['artifact', 'runId'])
  assert.equal(requestBody?.runId, RUN_ID)
  assert.deepEqual(requestBody?.artifact, artifact)
  assert.deepEqual(result, {
    runId: RUN_ID,
    created: true,
    contentSha256: HASH,
    artifactByteSize: 512,
    storedAt: undefined,
  })
})

test('save rejects likely secret fields before fetch and leaves the artifact unchanged', async () => {
  const artifact = {
    ...buildArtifact(),
    providerApiKeys: { groq: 'gsk_FAKE_TEST_ONLY_NOT_REAL' },
  } as BenchmarkRunHistoryEntry
  const before = JSON.stringify(artifact)
  let fetchCalled = false

  await assert.rejects(
    saveBenchmarkRunToCloud(artifact, {
      apiUrl: API_URL,
      randomUUID: () => RUN_ID,
      fetchImpl: (async () => {
        fetchCalled = true
        return jsonResponse(500, {})
      }) as typeof fetch,
    }),
    (error: unknown) => error instanceof CloudBenchmarkRunError && error.code === 'ARTIFACT_REJECTED',
  )

  assert.equal(fetchCalled, false)
  assert.equal(JSON.stringify(artifact), before)
})

test('load validates the cloud response and returns the existing run-history shape', async () => {
  const artifact = buildArtifact()
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), `${API_URL}/benchmark-runs/${RUN_ID}`)
    assert.equal(init?.method, 'GET')
    return jsonResponse(200, {
      runId: RUN_ID,
      artifact,
      contentSha256: HASH,
      artifactByteSize: 512,
      storedAt: '2026-08-15T00:01:00.000Z',
    })
  }) as typeof fetch

  const result = await loadBenchmarkRunFromCloud(RUN_ID.toUpperCase(), { apiUrl: API_URL, fetchImpl })
  assert.equal(result.runId, RUN_ID)
  assert.deepEqual(result.artifact, artifact)
})

test('load rejects invalid UUIDs locally and maps missing runs to a typed error', async () => {
  let fetchCalled = false
  await assert.rejects(
    loadBenchmarkRunFromCloud('not-a-uuid', {
      apiUrl: API_URL,
      fetchImpl: (async () => {
        fetchCalled = true
        return jsonResponse(500, {})
      }) as typeof fetch,
    }),
    (error: unknown) => error instanceof CloudBenchmarkRunError && error.code === 'INVALID_RUN_ID',
  )
  assert.equal(fetchCalled, false)

  await assert.rejects(
    loadBenchmarkRunFromCloud(RUN_ID, {
      apiUrl: API_URL,
      fetchImpl: (async () =>
        jsonResponse(404, { error: { code: 'RUN_NOT_FOUND', requestId: 'request-404' } })) as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof CloudBenchmarkRunError &&
      error.code === 'NOT_FOUND' &&
      error.status === 404 &&
      error.requestId === 'request-404',
  )
})

test('network and timeout failures are typed and never mutate the local artifact', async () => {
  const artifact = buildArtifact()
  const before = JSON.stringify(artifact)

  await assert.rejects(
    saveBenchmarkRunToCloud(artifact, {
      apiUrl: API_URL,
      randomUUID: () => RUN_ID,
      fetchImpl: (async () => {
        throw new TypeError('offline')
      }) as typeof fetch,
    }),
    (error: unknown) => error instanceof CloudBenchmarkRunError && error.code === 'UNAVAILABLE',
  )

  await assert.rejects(
    loadBenchmarkRunFromCloud(RUN_ID, {
      apiUrl: API_URL,
      timeoutMs: 5,
      fetchImpl: ((_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })) as typeof fetch,
    }),
    (error: unknown) => error instanceof CloudBenchmarkRunError && error.code === 'TIMEOUT',
  )

  assert.equal(JSON.stringify(artifact), before)
})

test('cloud-loaded runs reuse workspace duplicate and conflict detection', () => {
  const localRun = buildArtifact()
  const duplicateWorkspace = createWorkspaceExport({ benchmarkRunHistory: [buildArtifact()] })
  const duplicatePreview = buildWorkspaceImportPreview({
    workspace: duplicateWorkspace,
    localData: { benchmarkRunHistory: [localRun] },
  })
  assert.equal(duplicatePreview.exactDuplicateRunCount, 1)
  assert.equal(duplicatePreview.conflicts.length, 0)

  const conflictingWorkspace = createWorkspaceExport({ benchmarkRunHistory: [buildArtifact(2)] })
  const conflictPreview = buildWorkspaceImportPreview({
    workspace: conflictingWorkspace,
    localData: { benchmarkRunHistory: [localRun] },
  })
  assert.equal(conflictPreview.exactDuplicateRunCount, 0)
  assert.equal(conflictPreview.conflicts.length, 1)
  assert.equal(conflictPreview.conflicts[0]?.defaultAction, 'keep_both')
})
