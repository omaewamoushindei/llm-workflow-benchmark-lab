import assert from 'node:assert/strict'
import test from 'node:test'

import { POST as postBatchEvaluation } from './route'
import { POST as postModels } from '../models/route'

const runControls = {
  delayBetweenCallsMs: 0,
  delayBetweenWorkflowStepsMs: 0,
  maxRetries: 0,
  retryBackoffMode: 'provider_hint',
  maxOutputTokens: 600,
  continueOnError: true,
  stopAfterFailureRatePercent: 100,
  maxCasesPerRun: 10,
  maxConfigsPerRun: 10,
}

function buildRequestBody() {
  return {
    providerId: 'groq',
    apiKey: null,
    selectedModelIds: ['mock/groq-baseline', 'mock/groq-structured'],
    caseIds: ['thermo-sepsis-safe-discontinuation', 'thermo-hemodialysis-pneumonia-caution'],
    benchmarkConfigs: [
      {
        configId: 'raw-mock',
        label: 'Raw mock',
        configType: 'model_only',
        providerId: 'groq',
        modelId: 'mock/groq-baseline',
        promptTemplateId: 'default-baseline',
        stepCount: 1,
      },
      {
        configId: 'structured-mock',
        label: 'Structured mock',
        configType: 'model_only',
        providerId: 'groq',
        modelId: 'mock/groq-structured',
        promptTemplateId: 'default-structured-pct-json',
        stepCount: 1,
      },
      {
        configId: 'workflow-mock',
        label: 'Workflow mock',
        configType: 'workflow',
        providerId: 'groq',
        workflowId: 'workflow-mock',
        stepCount: 2,
        workflow: {
          id: 'workflow-mock',
          name: 'Workflow mock',
          description: 'Synthetic benchmark test workflow',
          steps: [
            {
              id: 'precheck',
              name: 'Reference precheck',
              stepType: 'deterministic_precheck',
              inputSource: 'case_data',
            },
            {
              id: 'report',
              name: 'Final report',
              stepType: 'final_report',
              modelId: 'mock/groq-baseline',
              inputSource: 'combined',
            },
          ],
        },
      },
    ],
    evaluationConfigs: [],
    evaluationWorkflows: [],
    promptTemplates: [],
    runControls,
  }
}

test('server mock mode runs the UI batch request without an API key', async () => {
  const previousMockMode = process.env.USE_MOCK_LLM
  process.env.USE_MOCK_LLM = 'true'

  try {
    const response = await postBatchEvaluation(
      new Request('http://localhost/api/batch-evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildRequestBody()),
      }),
    )
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.evaluationMode, 'mock')
    assert.equal(body.caseCount, 2)
    assert.equal(body.configCount, 3)
    assert.equal(body.estimatedCalls, 6)
    assert.equal(body.aggregate.failedModelCalls, 0)

    const results = body.cases.flatMap((caseResult: { results: unknown[] }) => caseResult.results)
    assert.equal(results.length, 6)
    assert.ok(results.every((result: { status: string; scores?: unknown }) => result.status === 'success' && result.scores))
    assert.ok(
      body.cases.every(
        (caseResult: { referenceDecision: { recommendation: string }; expectedReferenceLabel: string }) =>
          caseResult.referenceDecision.recommendation === caseResult.expectedReferenceLabel,
      ),
    )
  } finally {
    if (previousMockMode === undefined) delete process.env.USE_MOCK_LLM
    else process.env.USE_MOCK_LLM = previousMockMode
  }
})

test('mock model discovery works without credentials and returns explicit mock IDs', async () => {
  const previousMockMode = process.env.USE_MOCK_LLM
  process.env.USE_MOCK_LLM = 'true'

  try {
    const response = await postModels(
      new Request('http://localhost/api/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: 'groq' }),
      }),
    )
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.mode, 'mock')
    assert.equal(body.models.length, 3)
    assert.ok(body.models.every((model: { id: string }) => model.id.startsWith('mock/')))
  } finally {
    if (previousMockMode === undefined) delete process.env.USE_MOCK_LLM
    else process.env.USE_MOCK_LLM = previousMockMode
  }
})

test('live batch requests reject missing credentials instead of creating failed runs', async () => {
  const previousMockMode = process.env.USE_MOCK_LLM
  delete process.env.USE_MOCK_LLM

  try {
    const response = await postBatchEvaluation(
      new Request('http://localhost/api/batch-evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildRequestBody()),
      }),
    )
    const body = await response.json()

    assert.equal(response.status, 400)
    assert.match(body.error, /API key/i)
  } finally {
    if (previousMockMode === undefined) delete process.env.USE_MOCK_LLM
    else process.env.USE_MOCK_LLM = previousMockMode
  }
})

test('mock batch requests reject an empty configuration set', async () => {
  const previousMockMode = process.env.USE_MOCK_LLM
  process.env.USE_MOCK_LLM = 'true'

  try {
    const requestBody = buildRequestBody()
    requestBody.selectedModelIds = []
    requestBody.benchmarkConfigs = []
    const response = await postBatchEvaluation(
      new Request('http://localhost/api/batch-evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      }),
    )

    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /configuration/i)
  } finally {
    if (previousMockMode === undefined) delete process.env.USE_MOCK_LLM
    else process.env.USE_MOCK_LLM = previousMockMode
  }
})
