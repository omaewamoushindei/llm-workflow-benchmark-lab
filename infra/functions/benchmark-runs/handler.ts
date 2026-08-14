import { createHash } from 'node:crypto'

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

import {
  MAX_ARTIFACT_BYTES,
  isUuid,
  stableJsonStringify,
  validateCreateRequest,
} from './validation'

const DEFAULT_KEY_PREFIX = 'benchmark-runs/v1'
const MAX_REQUEST_BYTES = MAX_ARTIFACT_BYTES + 64 * 1024

type SafeLogRecord = {
  requestId: string
  route: 'POST /benchmark-runs' | 'GET /benchmark-runs/{runId}' | 'unsupported'
  runId?: string
  artifactByteSize?: number
  operationResult: string
  latencyMs: number
  safeAwsErrorClass?: string
}

type SafeLogger = {
  write(record: SafeLogRecord): void
}

type HandlerDependencies = {
  s3Client?: S3Client
  bucketName?: string
  keyPrefix?: string
  logger?: SafeLogger
  now?: () => number
}

type S3Error = Error & {
  $metadata?: { httpStatusCode?: number }
}

const defaultLogger: SafeLogger = {
  write(record) {
    console.log(JSON.stringify(record))
  },
}

function jsonResponse(statusCode: number, body: Record<string, unknown>): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  }
}

function errorResponse(
  statusCode: number,
  requestId: string,
  code: string,
  message: string,
  retryable = false,
): APIGatewayProxyStructuredResultV2 {
  return jsonResponse(statusCode, {
    error: {
      code,
      message,
      requestId,
      retryable,
    },
  })
}

function getRoute(event: APIGatewayProxyEventV2): SafeLogRecord['route'] {
  if (event.routeKey === 'POST /benchmark-runs') return 'POST /benchmark-runs'
  if (event.routeKey === 'GET /benchmark-runs/{runId}') return 'GET /benchmark-runs/{runId}'
  return 'unsupported'
}

function getRequestId(event: APIGatewayProxyEventV2): string {
  const requestId = event.requestContext?.requestId
  return typeof requestId === 'string' && requestId ? requestId.slice(0, 200) : 'unknown'
}

function getRunKey(keyPrefix: string, runId: string): string {
  return `${keyPrefix.replace(/\/+$/, '')}/${runId}.json`
}

function getSafeAwsErrorClass(error: unknown): string {
  const name = error instanceof Error ? error.name : 'AwsServiceError'
  const safeName = name.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80)
  return safeName || 'AwsServiceError'
}

function getHttpStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('$metadata' in error)) return undefined
  return (error as S3Error).$metadata?.httpStatusCode
}

function isConditionalWriteFailure(error: unknown): boolean {
  const errorClass = getSafeAwsErrorClass(error)
  const statusCode = getHttpStatusCode(error)
  return (
    statusCode === 409 ||
    statusCode === 412 ||
    errorClass === 'ConditionalRequestConflict' ||
    errorClass === 'PreconditionFailed'
  )
}

function isMissingObject(error: unknown): boolean {
  const errorClass = getSafeAwsErrorClass(error)
  const statusCode = getHttpStatusCode(error)
  return statusCode === 404 || errorClass === 'NoSuchKey' || errorClass === 'NotFound'
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

async function readBodyAsString(body: unknown): Promise<string> {
  if (
    typeof body === 'object' &&
    body !== null &&
    'transformToString' in body &&
    typeof body.transformToString === 'function'
  ) {
    return body.transformToString('utf-8')
  }

  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
  throw new Error('InvalidStoredObjectBody')
}

function parseRequestBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) throw new SyntaxError('Missing request body')
  const requestBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body

  if (Buffer.byteLength(requestBody, 'utf8') > MAX_REQUEST_BYTES) {
    const error = new Error('RequestTooLarge')
    error.name = 'RequestTooLarge'
    throw error
  }

  return JSON.parse(requestBody) as unknown
}

export function createHandler(dependencies: HandlerDependencies = {}) {
  const s3Client = dependencies.s3Client ?? new S3Client({})
  const bucketName = dependencies.bucketName ?? process.env.ARTIFACT_BUCKET_NAME
  const keyPrefix = dependencies.keyPrefix ?? process.env.ARTIFACT_KEY_PREFIX ?? DEFAULT_KEY_PREFIX
  const logger = dependencies.logger ?? defaultLogger
  const now = dependencies.now ?? Date.now

  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const startedAt = now()
    const requestId = getRequestId(event)
    const route = getRoute(event)
    let runId: string | undefined
    let artifactByteSize: number | undefined

    const finish = (
      response: APIGatewayProxyStructuredResultV2,
      operationResult: string,
      safeAwsErrorClass?: string,
    ): APIGatewayProxyStructuredResultV2 => {
      logger.write({
        requestId,
        route,
        runId,
        artifactByteSize,
        operationResult,
        latencyMs: Math.max(0, now() - startedAt),
        safeAwsErrorClass,
      })
      return response
    }

    if (!bucketName) {
      return finish(
        errorResponse(500, requestId, 'SERVER_MISCONFIGURED', 'Benchmark artifact storage is not configured.'),
        'server_misconfigured',
      )
    }

    if (route === 'POST /benchmark-runs') {
      const contentType = event.headers?.['content-type'] ?? event.headers?.['Content-Type']
      if (contentType && !contentType.toLowerCase().startsWith('application/json')) {
        return finish(
          errorResponse(415, requestId, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.'),
          'unsupported_media_type',
        )
      }

      let requestBody: unknown
      try {
        requestBody = parseRequestBody(event)
      } catch (error) {
        const tooLarge = error instanceof Error && error.name === 'RequestTooLarge'
        return finish(
          errorResponse(
            tooLarge ? 413 : 400,
            requestId,
            tooLarge ? 'ARTIFACT_TOO_LARGE' : 'INVALID_JSON',
            tooLarge ? 'The request exceeds the accepted size limit.' : 'The request body must be valid JSON.',
          ),
          tooLarge ? 'request_too_large' : 'invalid_json',
        )
      }

      const validation = validateCreateRequest(requestBody)
      if (!validation.ok) {
        if (typeof requestBody === 'object' && requestBody !== null && 'runId' in requestBody) {
          const candidateRunId = (requestBody as { runId?: unknown }).runId
          runId = typeof candidateRunId === 'string' && isUuid(candidateRunId) ? candidateRunId.toLowerCase() : undefined
        }
        return finish(
          errorResponse(
            validation.error.statusCode,
            requestId,
            validation.error.code,
            validation.error.message,
          ),
          'validation_rejected',
        )
      }

      runId = validation.value.runId
      artifactByteSize = validation.value.artifactByteSize
      const contentSha256 = sha256(validation.value.serializedArtifact)
      const key = getRunKey(keyPrefix, runId)

      try {
        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: validation.value.serializedArtifact,
            ContentType: 'application/json',
            ServerSideEncryption: 'AES256',
            IfNoneMatch: '*',
            Metadata: {
              'content-sha256': contentSha256,
            },
          }),
        )

        return finish(
          jsonResponse(201, {
            runId,
            created: true,
            contentSha256,
            artifactByteSize,
          }),
          'created',
        )
      } catch (error) {
        if (!isConditionalWriteFailure(error)) {
          const safeAwsErrorClass = getSafeAwsErrorClass(error)
          return finish(
            errorResponse(503, requestId, 'STORAGE_UNAVAILABLE', 'Benchmark artifact storage is unavailable.', true),
            'storage_error',
            safeAwsErrorClass,
          )
        }

        try {
          const existingObject = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }))
          const existingText = await readBodyAsString(existingObject.Body)
          const existingArtifact = JSON.parse(existingText) as unknown
          const existingCanonical = stableJsonStringify(existingArtifact)

          if (existingCanonical === validation.value.serializedArtifact) {
            return finish(
              jsonResponse(200, {
                runId,
                created: false,
                contentSha256,
                artifactByteSize,
              }),
              'idempotent_replay',
            )
          }

          return finish(
            errorResponse(409, requestId, 'RUN_ID_CONFLICT', 'runId already identifies a different artifact.'),
            'run_id_conflict',
          )
        } catch (readError) {
          const safeAwsErrorClass = getSafeAwsErrorClass(readError)
          return finish(
            errorResponse(503, requestId, 'STORAGE_UNAVAILABLE', 'Benchmark artifact storage is unavailable.', true),
            'conditional_read_error',
            safeAwsErrorClass,
          )
        }
      }
    }

    if (route === 'GET /benchmark-runs/{runId}') {
      const candidateRunId = event.pathParameters?.runId
      if (!isUuid(candidateRunId)) {
        return finish(
          errorResponse(400, requestId, 'INVALID_RUN_ID', 'runId must be a valid UUID.'),
          'invalid_run_id',
        )
      }

      runId = candidateRunId.toLowerCase()
      const key = getRunKey(keyPrefix, runId)

      try {
        const storedObject = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }))
        const storedText = await readBodyAsString(storedObject.Body)
        artifactByteSize = Buffer.byteLength(storedText, 'utf8')
        const artifact = JSON.parse(storedText) as unknown
        const validation = validateCreateRequest({ runId, artifact })
        if (!validation.ok) throw new Error('InvalidStoredArtifact')

        const contentSha256 = sha256(validation.value.serializedArtifact)
        return finish(
          jsonResponse(200, {
            runId,
            artifact,
            contentSha256,
            artifactByteSize,
            storedAt: storedObject.LastModified?.toISOString(),
          }),
          'retrieved',
        )
      } catch (error) {
        if (isMissingObject(error)) {
          return finish(
            errorResponse(404, requestId, 'RUN_NOT_FOUND', 'No benchmark artifact exists for this runId.'),
            'not_found',
          )
        }

        const safeAwsErrorClass = getSafeAwsErrorClass(error)
        return finish(
          errorResponse(503, requestId, 'STORAGE_UNAVAILABLE', 'Benchmark artifact storage is unavailable.', true),
          'storage_error',
          safeAwsErrorClass,
        )
      }
    }

    return finish(
      errorResponse(404, requestId, 'ROUTE_NOT_FOUND', 'Route not found.'),
      'route_not_found',
    )
  }
}

export const handler = createHandler()
