import type { BenchmarkRunHistoryEntry } from '../../../lib/workspace-sharing'

export const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024

const WORKSPACE_SCHEMA_VERSION = '1.0'
const SCORING_VERSION = '1.0'
const WORKSPACE_APP_NAME = 'LLM Workflow Benchmark Lab'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

type ValidationErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_RUN_ID'
  | 'INVALID_ARTIFACT'
  | 'INCOMPLETE_ARTIFACT'
  | 'ARTIFACT_TOO_LARGE'
  | 'SECRET_DETECTED'

export type ValidationError = {
  code: ValidationErrorCode
  message: string
  statusCode: 400 | 413
}

export type ValidatedCreateRequest = {
  runId: string
  artifact: BenchmarkRunHistoryEntry
  serializedArtifact: string
  artifactByteSize: number
}

export type CreateRequestValidationResult =
  | { ok: true; value: ValidatedCreateRequest }
  | { ok: false; error: ValidationError }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown, maxLength = 500): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}

function isValidTimestamp(value: unknown): value is string {
  return isNonEmptyString(value, 100) && Number.isFinite(Date.parse(value))
}

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function isSecretFieldName(value: string): boolean {
  const normalized = normalizeFieldName(value)
  return (
    SECRET_FIELD_NAMES.has(normalized) ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('authtoken') ||
    normalized.endsWith('accesstoken') ||
    normalized.endsWith('refreshtoken') ||
    normalized.endsWith('clientsecret')
  )
}

export function containsLikelySecret(value: unknown): boolean {
  if (typeof value === 'string') {
    return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))
  }

  if (Array.isArray(value)) {
    return value.some(containsLikelySecret)
  }

  if (!isRecord(value)) return false

  return Object.entries(value).some(([key, nestedValue]) => {
    if (isSecretFieldName(key)) return true
    return containsLikelySecret(nestedValue)
  })
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : stableJsonStringify(item))).join(',')}]`
  }

  if (isRecord(value)) {
    const fields = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
    return `{${fields.join(',')}}`
  }

  const serialized = JSON.stringify(value)
  return serialized === undefined ? 'null' : serialized
}

function validateCaseResults(cases: unknown[]): boolean {
  if (cases.length === 0) return false

  return cases.every((caseResult) => {
    if (!isRecord(caseResult)) return false
    if (!isNonEmptyString(caseResult.caseId) || !isNonEmptyString(caseResult.title)) return false
    if (!isRecord(caseResult.caseData)) return false
    if (!isRecord(caseResult.referenceDecision) || !isRecord(caseResult.referenceChecks)) return false
    if (!Array.isArray(caseResult.results) || caseResult.results.length === 0) return false

    return caseResult.results.every((result) => {
      if (!isRecord(result) || !isNonEmptyString(result.configId)) return false
      return result.status === 'success' || result.status === 'error'
    })
  })
}

function validateArtifactStructure(artifact: Record<string, unknown>): ValidationError | null {
  if (
    artifact.schemaVersion !== WORKSPACE_SCHEMA_VERSION ||
    artifact.scoringVersion !== SCORING_VERSION ||
    artifact.appName !== WORKSPACE_APP_NAME
  ) {
    return {
      code: 'INVALID_ARTIFACT',
      message: 'The artifact schema, scoring version, or application name is unsupported.',
      statusCode: 400,
    }
  }

  if (
    !isNonEmptyString(artifact.batchId, 200) ||
    !isValidTimestamp(artifact.createdAt) ||
    (artifact.providerId !== 'openrouter' && artifact.providerId !== 'groq') ||
    !isRecord(artifact.aggregate) ||
    !Array.isArray(artifact.cases) ||
    !isRecord(artifact.rawBatch)
  ) {
    return {
      code: 'INVALID_ARTIFACT',
      message: 'The artifact does not match the BenchmarkRunHistoryEntry structure.',
      statusCode: 400,
    }
  }

  const optionalArrays = [
    artifact.benchmarkConfigs,
    artifact.criteriaSnapshot,
    artifact.promptTemplatesSnapshot,
    artifact.workflowsSnapshot,
    artifact.casesSnapshot,
  ]
  if (optionalArrays.some((value) => value !== undefined && !Array.isArray(value))) {
    return {
      code: 'INVALID_ARTIFACT',
      message: 'One or more optional artifact snapshots are invalid.',
      statusCode: 400,
    }
  }

  if (artifact.runControls !== undefined && !isRecord(artifact.runControls)) {
    return {
      code: 'INVALID_ARTIFACT',
      message: 'The artifact run controls are invalid.',
      statusCode: 400,
    }
  }

  if (artifact.contentHash !== undefined && !isNonEmptyString(artifact.contentHash, 200)) {
    return {
      code: 'INVALID_ARTIFACT',
      message: 'The artifact content hash is invalid.',
      statusCode: 400,
    }
  }

  return null
}

function validateCompletedArtifact(artifact: Record<string, unknown>): ValidationError | null {
  const rawBatch = artifact.rawBatch as Record<string, unknown>
  const cases = artifact.cases as unknown[]

  if (
    rawBatch.batchId !== artifact.batchId ||
    rawBatch.createdAt !== artifact.createdAt ||
    rawBatch.providerId !== artifact.providerId ||
    !Array.isArray(rawBatch.cases) ||
    !isRecord(rawBatch.aggregate) ||
    !validateCaseResults(cases)
  ) {
    return {
      code: 'INCOMPLETE_ARTIFACT',
      message: 'The artifact is not a completed benchmark run.',
      statusCode: 400,
    }
  }

  if (
    stableJsonStringify(rawBatch.cases) !== stableJsonStringify(cases) ||
    stableJsonStringify(rawBatch.aggregate) !== stableJsonStringify(artifact.aggregate)
  ) {
    return {
      code: 'INCOMPLETE_ARTIFACT',
      message: 'The artifact and raw batch snapshots are inconsistent.',
      statusCode: 400,
    }
  }

  return null
}

export function validateCreateRequest(value: unknown): CreateRequestValidationResult {
  if (!isRecord(value) || !Object.hasOwn(value, 'runId') || !Object.hasOwn(value, 'artifact')) {
    return {
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'The request must contain runId and artifact.',
        statusCode: 400,
      },
    }
  }

  if (!isUuid(value.runId)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_RUN_ID',
        message: 'runId must be a valid UUID.',
        statusCode: 400,
      },
    }
  }

  if (!isRecord(value.artifact)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARTIFACT',
        message: 'artifact must be a BenchmarkRunHistoryEntry object.',
        statusCode: 400,
      },
    }
  }

  const structureError = validateArtifactStructure(value.artifact)
  if (structureError) return { ok: false, error: structureError }

  const completionError = validateCompletedArtifact(value.artifact)
  if (completionError) return { ok: false, error: completionError }

  if (containsLikelySecret(value.artifact)) {
    return {
      ok: false,
      error: {
        code: 'SECRET_DETECTED',
        message: 'The artifact contains a likely secret or authentication token.',
        statusCode: 400,
      },
    }
  }

  const serializedArtifact = stableJsonStringify(value.artifact)
  const artifactByteSize = Buffer.byteLength(serializedArtifact, 'utf8')
  if (artifactByteSize > MAX_ARTIFACT_BYTES) {
    return {
      ok: false,
      error: {
        code: 'ARTIFACT_TOO_LARGE',
        message: 'The serialized artifact exceeds the 4 MiB limit.',
        statusCode: 413,
      },
    }
  }

  return {
    ok: true,
    value: {
      runId: value.runId.toLowerCase(),
      artifact: value.artifact as unknown as BenchmarkRunHistoryEntry,
      serializedArtifact,
      artifactByteSize,
    },
  }
}
