import assert from 'node:assert/strict'
import test from 'node:test'

import { benchmarkCases } from './benchmark-cases'
import { deriveReferenceChecks, evaluateReferenceDecision } from './pct-reference'
import { scoreLlmOutput } from './scoring'
import type { LlmParsedOutput } from './types'

test('every built-in benchmark case matches its declared deterministic reference label', () => {
  for (const benchmarkCase of benchmarkCases) {
    const decision = evaluateReferenceDecision(benchmarkCase.caseData)
    assert.equal(decision.recommendation, benchmarkCase.expectedReferenceLabel, benchmarkCase.id)
  }
})

test('a fully aligned structured result receives the expected benchmark scores', () => {
  const benchmarkCase = benchmarkCases.find((candidate) => candidate.id === 'thermo-sepsis-safe-discontinuation')
  assert.ok(benchmarkCase)

  const decision = evaluateReferenceDecision(benchmarkCase.caseData)
  const checks = deriveReferenceChecks(benchmarkCase.caseData, decision)
  const parsedOutput: LlmParsedOutput = {
    recommendation: decision.recommendation,
    absolute_threshold_met: checks.absoluteThresholdMet,
    pct_decline_threshold_met: checks.pctDeclineCriterionMet,
    clinical_improvement_required: true,
    clinical_improvement_present: checks.clinicalImprovementPresent,
    exclusion_condition_present: checks.exclusionConditionPresent,
    safety_gate_passed: checks.discontinuationGatePassed,
    calculation_audit: {
      current_pct: benchmarkCase.caseData.currentPct,
      threshold_used: decision.thresholdUsed,
      current_pct_less_or_equal_threshold: checks.absoluteThresholdMet,
      peak_pct: benchmarkCase.caseData.peakPct,
      pct_decline_percent: decision.pctDeclinePercent,
      pct_decline_greater_than_80: checks.pctDeclineCriterionMet,
    },
    pct_interpretation: 'The current PCT and calculated decline satisfy the implemented deterministic criteria.',
    threshold_used: decision.thresholdUsed,
    pct_decline_calculated: decision.pctDeclinePercent,
    reasoning_summary: 'The structured fields, clinical improvement, and PCT kinetics align with the reference decision.',
    safety_warnings: [],
    missing_information: [],
    confidence: 'high',
  }

  assert.deepEqual(scoreLlmOutput(parsedOutput, decision, benchmarkCase.caseData, checks), {
    recommendationMatch: 100,
    alignment: 80,
    safety: 100,
    explainability: 100,
  })
})

test('caution cases keep the discontinuation safety gate closed', () => {
  const benchmarkCase = benchmarkCases.find((candidate) => candidate.id === 'thermo-hemodialysis-pneumonia-caution')
  assert.ok(benchmarkCase)

  const decision = evaluateReferenceDecision(benchmarkCase.caseData)
  const checks = deriveReferenceChecks(benchmarkCase.caseData, decision)

  assert.equal(decision.recommendation, 'clinical_review_required')
  assert.equal(checks.exclusionConditionPresent, true)
  assert.equal(checks.discontinuationGatePassed, false)
  assert.ok(decision.safetyConcerns.length > 0)
})
