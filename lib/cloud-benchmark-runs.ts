import {
  SCORING_VERSION,
  WORKSPACE_APP_NAME,
  WORKSPACE_SCHEMA_VERSION,
  stableStringify,
  type BenchmarkRunHistoryEntry,
} from './workspace-sharing'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/i

const SECRET_FIELD_NAMES = new Set([
  'apikey',
  'providerapikey',
  'providerapikeys',
  'authorization',
  'authtoken',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'bearertoken',
  'secretaccesskey',
  'awssecretaccesskey',
  'clientsecret',
  'password',
  'credentials',
])

const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/i,
  /\b(?:gsk_|sk-or-v1-|sk-)[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /["']?(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["'][^"']{8,}["']/i,
]

export type CloudBenchmarkRunErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_RUN_ID'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'ARTIFACT_REJECTED'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'

export class CloudBenchmarkRunError extends Error {
  readonly code: CloudBenchmarkRunErrorCode
  readonly status?: number
  readonly requestId?: string

  constructor(
    code: CloudBenchmarkRunErrorCode,
    message: string,
    options: { status?: number; requestId?: string } = {},
  ) {
    super(message)
    this.name = 'CloudBenchmarkRunError'
    this.code = code
    this.status = options.status
    this.requestId = options.requestId
  }
}

export type SaveBenchmarkRunResult = {
  runId: string
  created: boolean
  contentSha256: string
  artifactByteSize: number
  storedAt?: string
}

export type LoadBenchmarkRunResult = {
  runId: string
  artifact: BenchmarkRunHistoryEntry
  contentSha256: string
  artifactByteSize: number
  storedAt?: string
}

type CloudClientOptions = {
  apiUrl?: string
  fetchImpl?: typeof fetch
  randomUUID?: () => string
  timeoutMs?: number
}

type ErrorEnvelope = {
  error?: {
    code?: unknown
    requestId?: unknown
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function containsLikelySecret(value: unknown): boolean {
  if (typeof value === 'string') return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))
  if (Array.isArray(value)) return value.some(containsLikelySecret)
  if (!isRecord(value)) return false

  return Object.entries(value).some(([key, nestedValue]) => {
    const normalized = normalizeFieldName(key)
    if (
      SECRET_FIELD_NAMES.has(normalized) ||
      normalized.endsWith('apikey') ||
      normalized.endsWith('authtoken') ||
      normalized.endsWith('accesstoken') ||
      normalized.endsWith('refreshtoken') ||
      normalized.endsWith('clientsecret')
    ) {
      return true
    }
    return containsLikelySecret(nestedValue)
  })
}

function isCompletedBenchmarkRun(value: unknown): value is BenchmarkRunHistoryEntry {
  if (!isRecord(value)) return false
  if (
    value.schemaVersion !== WORKSPACE_SCHEMA_VERSION ||
    value.scoringVersion !== SCORING_VERSION ||
    value.appName !== WORKSPACE_APP_NAME ||
    typeof value.batchId !== 'string' ||
    !value.batchId ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    (value.providerId !== 'openrouter' && value.providerId !== 'groq') ||
    !isRecord(value.aggregate) ||
    !Array.isArray(value.cases) ||
    value.cases.length === 0 ||
    !isRecord(value.rawBatch)
  ) {
    return false
  }

  const rawBatch = value.rawBatch
  if (
    rawBatch.batchId !== value.batchId ||
    rawBatch.createdAt !== value.createdAt ||
    rawBatch.providerId !== value.providerId ||
    !Array.isArray(rawBatch.cases) ||
    !isRecord(rawBatch.aggregate) ||
    stableStringify(rawBatch.cases) !== stableStringify(value.cases) ||
    stableStringify(rawBatch.aggregate) !== stableStringify(value.aggregate)
  ) {
    return false
  }

  return value.cases.every((caseResult) => {
    if (
      !isRecord(caseResult) ||
      typeof caseResult.caseId !== 'string' ||
      !caseResult.caseId ||
      typeof caseResult.title !== 'string' ||
      !caseResult.title ||
      !isRecord(caseResult.caseData) ||
      !isRecord(caseResult.referenceDecision) ||
      !isRecord(caseResult.referenceChecks) ||
      !Array.isArray(caseResult.results) ||
      caseResult.results.length === 0
    ) {
      return false
    }
    return caseResult.results.every(
      (result) =>
        isRecord(result) &&
        typeof result.configId === 'string' &&
        Boolean(result.configId) &&
        (result.status === 'success' || result.status === 'error'),
    )
  })
}

export function isCloudRunId(value: string): boolean {
  return UUID_PATTERN.test(value.trim())
}

export function isCloudBenchmarkRunsConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_BENCHMARK_RUNS_API_URL?.trim())
}

function resolveApiUrl(explicitApiUrl?: string): string {
  const configured = (explicitApiUrl ?? process.env.NEXT_PUBLIC_BENCHMARK_RUNS_API_URL ?? '').trim()
  if (!configured) {
    throw new CloudBenchmarkRunError('NOT_CONFIGURED', 'Cloud benchmark persistence is not configured.')
  }

  try {
    const url = new URL(configured)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid cloud API URL')
    }
    return url.toString().replace(/\/+$/, '')
  } catch {
    throw new CloudBenchmarkRunError('NOT_CONFIGURED', 'Cloud benchmark persistence is not configured correctly.')
  }
}

function getFetch(options: CloudClientOptions): typeof fetch {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (!fetchImpl) throw new CloudBenchmarkRunError('UNAVAILABLE', 'Cloud benchmark persistence is unavailable.')
  return fetchImpl
}

async function requestJson(
  path: string,
  init: RequestInit,
  options: CloudClientOptions,
): Promise<{ response: Response; body: unknown }> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await getFetch(options)(`${resolveApiUrl(options.apiUrl)}${path}`, {
      ...init,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new CloudBenchmarkRunError('INVALID_RESPONSE', 'The cloud API returned an invalid response.', {
        status: response.status,
      })
    }
    return { response, body }
  } catch (error) {
    if (error instanceof CloudBenchmarkRunError) throw error
    if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
      throw new CloudBenchmarkRunError('TIMEOUT', 'The cloud request timed out.')
    }
    throw new CloudBenchmarkRunError('UNAVAILABLE', 'The cloud API is unavailable.')
  } finally {
    clearTimeout(timeout)
  }
}

function getErrorRequestId(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined
  const requestId = (body as ErrorEnvelope).error?.requestId
  return typeof requestId === 'string' ? requestId : undefined
}

function throwForErrorResponse(status: number, body: unknown): never {
  const requestId = getErrorRequestId(body)
  const backendCode = isRecord(body) && isRecord(body.error) ? body.error.code : undefined
  if (status === 404) {
    throw new CloudBenchmarkRunError('NOT_FOUND', 'Cloud run not found.', { status, requestId })
  }
  if (status === 409) {
    throw new CloudBenchmarkRunError('CONFLICT', 'The Cloud Run ID already contains different content.', {
      status,
      requestId,
    })
  }
  if (status === 400 || status === 413 || backendCode === 'SECRET_DETECTED') {
    throw new CloudBenchmarkRunError('ARTIFACT_REJECTED', 'The cloud API rejected the benchmark artifact.', {
      status,
      requestId,
    })
  }
  if (status >= 500) {
    throw new CloudBenchmarkRunError('UNAVAILABLE', 'The cloud API is unavailable.', { status, requestId })
  }
  throw new CloudBenchmarkRunError('INVALID_RESPONSE', 'The cloud API returned an unexpected response.', {
    status,
    requestId,
  })
}

function isValidResponseMetadata(value: Record<string, unknown>): boolean {
  return (
    typeof value.contentSha256 === 'string' &&
    SHA256_PATTERN.test(value.contentSha256) &&
    typeof value.artifactByteSize === 'number' &&
    Number.isSafeInteger(value.artifactByteSize) &&
    value.artifactByteSize >= 0 &&
    (value.storedAt === undefined || typeof value.storedAt === 'string')
  )
}

export async function saveBenchmarkRunToCloud(
  artifact: BenchmarkRunHistoryEntry,
  options: CloudClientOptions = {},
): Promise<SaveBenchmarkRunResult> {
  const serializedArtifact = stableStringify(artifact)
  if (
    !isCompletedBenchmarkRun(artifact) ||
    containsLikelySecret(artifact) ||
    new TextEncoder().encode(serializedArtifact).byteLength > MAX_ARTIFACT_BYTES
  ) {
    throw new CloudBenchmarkRunError('ARTIFACT_REJECTED', 'The benchmark artifact cannot be sent to cloud storage.')
  }

  const randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID())
  const runId = randomUUID().toLowerCase()
  if (!isCloudRunId(runId)) {
    throw new CloudBenchmarkRunError('INVALID_RESPONSE', 'The browser could not generate a valid Cloud Run ID.')
  }

  const { response, body } = await requestJson(
    '/benchmark-runs',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, artifact }),
    },
    options,
  )
  if (response.status !== 200 && response.status !== 201) throwForErrorResponse(response.status, body)
  if (
    !isRecord(body) ||
    body.runId !== runId ||
    typeof body.created !== 'boolean' ||
    !isValidResponseMetadata(body)
  ) {
    throw new CloudBenchmarkRunError('INVALID_RESPONSE', 'The cloud API returned invalid save metadata.', {
      status: response.status,
    })
  }

  return {
    runId,
    created: body.created,
    contentSha256: body.contentSha256 as string,
    artifactByteSize: body.artifactByteSize as number,
    storedAt: typeof body.storedAt === 'string' ? body.storedAt : undefined,
  }
}

export async function loadBenchmarkRunFromCloud(
  runIdInput: string,
  options: CloudClientOptions = {},
): Promise<LoadBenchmarkRunResult> {
  const runId = runIdInput.trim().toLowerCase()
  if (!isCloudRunId(runId)) {
    throw new CloudBenchmarkRunError('INVALID_RUN_ID', 'Enter a valid Cloud Run ID.')
  }

  const { response, body } = await requestJson(
    `/benchmark-runs/${encodeURIComponent(runId)}`,
    { method: 'GET' },
    options,
  )
  if (response.status !== 200) throwForErrorResponse(response.status, body)
  if (
    !isRecord(body) ||
    body.runId !== runId ||
    !isCompletedBenchmarkRun(body.artifact) ||
    containsLikelySecret(body.artifact) ||
    !isValidResponseMetadata(body)
  ) {
    throw new CloudBenchmarkRunError('INVALID_RESPONSE', 'The cloud API returned an invalid benchmark artifact.', {
      status: response.status,
    })
  }

  return {
    runId,
    artifact: body.artifact,
    contentSha256: body.contentSha256 as string,
    artifactByteSize: body.artifactByteSize as number,
    storedAt: typeof body.storedAt === 'string' ? body.storedAt : undefined,
  }
}
