import assert from 'node:assert/strict'
import test from 'node:test'

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

import type { BenchmarkRunHistoryEntry } from '../../lib/workspace-sharing'
import { createHandler } from '../functions/benchmark-runs/handler'
import { MAX_ARTIFACT_BYTES, validateCreateRequest } from '../functions/benchmark-runs/validation'

const RUN_ID = '3bc956b2-0386-4daf-b980-7c4669fd19d9'
const BUCKET_NAME = 'test-benchmark-artifacts'
const OBJECT_KEY = `benchmark-runs/v1/${RUN_ID}.json`

type StoredObject = {
  body: string
  lastModified: Date
}

class FakeS3Client {
  readonly objects = new Map<string, StoredObject>()

  async send(command: PutObjectCommand | GetObjectCommand): Promise<Record<string, unknown>> {
    if (command instanceof PutObjectCommand) {
      const key = command.input.Key
      assert.equal(command.input.Bucket, BUCKET_NAME)
      assert.ok(key)
      assert.equal(command.input.IfNoneMatch, '*')
      assert.equal(command.input.ServerSideEncryption, 'AES256')

      if (this.objects.has(key)) {
        const error = new Error('Object already exists') as Error & { $metadata: { httpStatusCode: number } }
        error.name = 'PreconditionFailed'
        error.$metadata = { httpStatusCode: 412 }
        throw error
      }

      assert.equal(typeof command.input.Body, 'string')
      this.objects.set(key, {
        body: command.input.Body as string,
        lastModified: new Date('2026-08-13T12:00:02.000Z'),
      })
      return { ETag: 'test-etag' }
    }

    if (command instanceof GetObjectCommand) {
      const key = command.input.Key
      assert.equal(command.input.Bucket, BUCKET_NAME)
      assert.ok(key)
      const stored = this.objects.get(key)
      if (!stored) {
        const error = new Error('Object does not exist') as Error & { $metadata: { httpStatusCode: number } }
        error.name = 'NoSuchKey'
        error.$metadata = { httpStatusCode: 404 }
        throw error
      }

      return {
        Body: {
          transformToString: async () => stored.body,
        },
        LastModified: stored.lastModified,
      }
    }

    throw new Error('Unsupported test command')
  }
}

class CapturingLogger {
  readonly records: Array<Record<string, unknown>> = []

  write(record: Record<string, unknown>) {
    this.records.push(record)
  }
}

function buildArtifact(rawOutput = '{"recommendation":"consider_discontinuation"}'): BenchmarkRunHistoryEntry {
  const caseResult = {
    caseId: 'synthetic-case',
    title: 'Synthetic test case',
    sourceType: 'synthetic_algorithm_case',
    tags: ['synthetic'],
    caseData: {
      patientAge: 50,
      sex: 'unspecified',
      symptoms: 'synthetic symptoms',
      infectionContext: 'lrti_non_icu',
      clinicalImprovement: 'yes',
      currentAntibioticStatus: 'empirical',
      antibioticsDurationDays: 3,
      peakPct: 1,
      currentPct: 0.1,
      wbc: 8,
      crp: 10,
      exclusionCondition: 'none',
      clinicalNotes: 'Synthetic test data only.',
      caseDescription: 'Synthetic test data only.',
    },
    expectedReferenceLabel: 'consider_discontinuation',
    referenceDecision: {
      recommendation: 'consider_discontinuation',
    },
    referenceChecks: {
      absoluteThresholdMet: true,
    },
    results: [
      {
        configId: 'mock-config',
        modelLabel: 'Mock model',
        promptStrategy: 'Structured Prompt',
        status: 'success',
        rawOutput,
      },
    ],
  }
  const aggregate = {
    averageRecommendationMatch: 100,
    averageCriterionAlignment: 100,
    averageSafety: 100,
    averageExplainability: 100,
    totalSafetyWarnings: 0,
    failedModelCalls: 0,
  }

  return {
    schemaVersion: '1.0',
    scoringVersion: '1.0',
    appName: 'LLM Workflow Benchmark Lab',
    batchId: 'batch-test',
    createdAt: '2026-08-13T12:00:00.000Z',
    providerId: 'openrouter',
    aggregate,
    cases: [caseResult],
    rawBatch: {
      batchId: 'batch-test',
      createdAt: '2026-08-13T12:00:00.000Z',
      providerId: 'openrouter',
      aggregate,
      cases: [caseResult],
    },
  }
}

function buildEvent(args: {
  routeKey: 'POST /benchmark-runs' | 'GET /benchmark-runs/{runId}'
  body?: unknown
  runId?: string
}): APIGatewayProxyEventV2 {
  const method = args.routeKey.startsWith('POST') ? 'POST' : 'GET'
  const path = method === 'POST' ? '/benchmark-runs' : `/benchmark-runs/${args.runId ?? RUN_ID}`
  return {
    version: '2.0',
    routeKey: args.routeKey,
    rawPath: path,
    rawQueryString: '',
    headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      domainName: 'test.example.com',
      domainPrefix: 'test',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'node-test',
      },
      requestId: `request-${method.toLowerCase()}`,
      routeKey: args.routeKey,
      stage: '$default',
      time: '13/Aug/2026:12:00:00 +0000',
      timeEpoch: 1786622400000,
    },
    pathParameters: method === 'GET' ? { runId: args.runId ?? RUN_ID } : undefined,
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
    isBase64Encoded: false,
  }
}

function parseResponse(response: APIGatewayProxyStructuredResultV2): Record<string, unknown> {
  assert.equal(typeof response.body, 'string')
  return JSON.parse(response.body as string) as Record<string, unknown>
}

function createTestHandler(fakeS3: FakeS3Client, logger = new CapturingLogger()) {
  return {
    handler: createHandler({
      s3Client: fakeS3 as unknown as S3Client,
      bucketName: BUCKET_NAME,
      logger,
      now: () => 100,
    }),
    logger,
  }
}

test('POST creates an artifact with a conditional write and GET retrieves it', async () => {
  const fakeS3 = new FakeS3Client()
  const { handler } = createTestHandler(fakeS3)
  const artifact = buildArtifact()

  const createResponse = await handler(
    buildEvent({ routeKey: 'POST /benchmark-runs', body: { runId: RUN_ID, artifact } }),
  )
  assert.equal(createResponse.statusCode, 201)
  assert.equal(parseResponse(createResponse).created, true)
  assert.ok(fakeS3.objects.has(OBJECT_KEY))

  const getResponse = await handler(
    buildEvent({ routeKey: 'GET /benchmark-runs/{runId}', runId: RUN_ID }),
  )
  assert.equal(getResponse.statusCode, 200)
  const getBody = parseResponse(getResponse)
  assert.equal(getBody.runId, RUN_ID)
  assert.deepEqual(getBody.artifact, artifact)
  assert.equal(getBody.storedAt, '2026-08-13T12:00:02.000Z')
})

test('POST returns 200 for an identical retry without overwriting the object', async () => {
  const fakeS3 = new FakeS3Client()
  const { handler } = createTestHandler(fakeS3)
  const artifact = buildArtifact()
  const event = buildEvent({ routeKey: 'POST /benchmark-runs', body: { runId: RUN_ID, artifact } })

  assert.equal((await handler(event)).statusCode, 201)
  const originalBody = fakeS3.objects.get(OBJECT_KEY)?.body
  const retryResponse = await handler(event)

  assert.equal(retryResponse.statusCode, 200)
  assert.equal(parseResponse(retryResponse).created, false)
  assert.equal(fakeS3.objects.get(OBJECT_KEY)?.body, originalBody)
  assert.equal(fakeS3.objects.size, 1)
})

test('POST returns 409 when the UUID already identifies different content', async () => {
  const fakeS3 = new FakeS3Client()
  const { handler } = createTestHandler(fakeS3)
  const artifact = buildArtifact()

  assert.equal(
    (await handler(buildEvent({ routeKey: 'POST /benchmark-runs', body: { runId: RUN_ID, artifact } }))).statusCode,
    201,
  )

  const conflictingArtifact = buildArtifact('{"recommendation":"continue_antibiotics"}')
  const conflictResponse = await handler(
    buildEvent({ routeKey: 'POST /benchmark-runs', body: { runId: RUN_ID, artifact: conflictingArtifact } }),
  )
  assert.equal(conflictResponse.statusCode, 409)
  const error = parseResponse(conflictResponse).error as Record<string, unknown>
  assert.equal(error.code, 'RUN_ID_CONFLICT')
})

test('validation rejects invalid UUIDs, incomplete artifacts, oversized artifacts, and likely secrets', () => {
  const invalidUuid = validateCreateRequest({ runId: 'batch-123', artifact: buildArtifact() })
  assert.equal(invalidUuid.ok, false)
  if (!invalidUuid.ok) assert.equal(invalidUuid.error.code, 'INVALID_RUN_ID')

  const incompleteArtifact = buildArtifact()
  incompleteArtifact.cases = []
  ;(incompleteArtifact.rawBatch as Record<string, unknown>).cases = []
  const incomplete = validateCreateRequest({ runId: RUN_ID, artifact: incompleteArtifact })
  assert.equal(incomplete.ok, false)
  if (!incomplete.ok) assert.equal(incomplete.error.code, 'INCOMPLETE_ARTIFACT')

  const oversized = validateCreateRequest({
    runId: RUN_ID,
    artifact: buildArtifact('x'.repeat(MAX_ARTIFACT_BYTES)),
  })
  assert.equal(oversized.ok, false)
  if (!oversized.ok) assert.equal(oversized.error.code, 'ARTIFACT_TOO_LARGE')

  const secretArtifact = buildArtifact()
  ;(secretArtifact.rawBatch as Record<string, unknown>).apiKey = 'sk-this-is-a-secret-provider-key'
  const secret = validateCreateRequest({ runId: RUN_ID, artifact: secretArtifact })
  assert.equal(secret.ok, false)
  if (!secret.ok) assert.equal(secret.error.code, 'SECRET_DETECTED')
})

test('structured logs contain only the approved fields and never include request content', async () => {
  const fakeS3 = new FakeS3Client()
  const { handler, logger } = createTestHandler(fakeS3)
  const secretArtifact = buildArtifact()
  ;(secretArtifact.rawBatch as Record<string, unknown>).authorization = 'Bearer should-not-be-logged-at-all'

  const response = await handler(
    buildEvent({ routeKey: 'POST /benchmark-runs', body: { runId: RUN_ID, artifact: secretArtifact } }),
  )
  assert.equal(response.statusCode, 400)
  assert.equal(logger.records.length, 1)

  const allowedKeys = new Set([
    'requestId',
    'route',
    'runId',
    'artifactByteSize',
    'operationResult',
    'latencyMs',
    'safeAwsErrorClass',
  ])
  for (const key of Object.keys(logger.records[0])) assert.ok(allowedKeys.has(key))

  const serializedLogs = JSON.stringify(logger.records)
  assert.equal(serializedLogs.includes('should-not-be-logged-at-all'), false)
  assert.equal(serializedLogs.includes('authorization'), false)
  assert.equal(serializedLogs.includes('rawOutput'), false)
})
