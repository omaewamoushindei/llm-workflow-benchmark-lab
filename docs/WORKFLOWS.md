# Workflows

The Workflow Builder lets users compare single-call and multi-step evaluation configurations.

## Raw Model Baseline

A raw baseline is a single LLM call using a baseline prompt. It is useful for comparing how a model behaves with minimal structure.

## Structured Prompt Baseline

A structured baseline is a single LLM call using a JSON-oriented prompt. It asks the model to return fields required by the scoring schema.

## Verification Workflow

A verification workflow uses a primary LLM output followed by a verifier step. The verifier checks or revises the structured criteria. In the current MVP, the final/verifier output is used for scoring when parseable.

## Deterministic Precheck + Explanation

This workflow uses backend-computed deterministic checks as an explicit tool-assisted precheck, then asks an LLM to explain or format the result. It should be labeled separately from raw model reasoning because the LLM receives deterministic reference information.

## Multi-Step Workflow Concept

Multi-step workflows are linear sequences of steps. The A1-A4 PCT Pipeline is an example:

- A1 Intake & Validation
- A2 Clinical Reasoning
- A3 Kinetic & Context Analysis
- A4 Final Structured Report

The final step output is used for scoring when it returns parseable JSON.

## Input Source Semantics

- `case_data`: include only original structured case data and case description/context.
- `previous_step`: include the immediate previous step output.
- `combined`: include original case data plus all previous step outputs.
- `reference_checks`: include deterministic reference checks. This should be used only for explicit deterministic/tool-assisted workflows.

## Workflow Execution Trace

Workflow traces help verify that each step received the intended inputs.

Trace metadata can include:

- step name and type
- model and prompt template
- input source
- whether previous step outputs were included
- which step outputs were included
- whether reference checks were included
- output preview
- parsing status
- error details if a step failed

The trace is intended for debugging workflow stability and transparency.
