# Evaluation Methodology

This project evaluates LLM workflow behavior against deterministic reference logic. It does not evaluate clinical correctness in the real world.

## What Is Being Evaluated

The platform compares benchmark configurations such as:

- raw model calls
- structured prompt baselines
- verification workflows
- deterministic precheck + explanation workflows
- custom multi-step workflows

Each configuration is evaluated on benchmark cases and scored using parsed model outputs.

## Deterministic Reference Logic

The PCT case study uses deterministic rule logic as a benchmark proxy. The backend computes:

- reference recommendation
- absolute threshold checks
- PCT decline checks
- clinical improvement status
- exclusion/caution condition status
- discontinuation gate status

The model does not receive the final expected label in ordinary benchmark prompts. It receives case data and rule instructions, while scoring compares its output to backend-computed checks.

## Recommendation Match

Recommendation match measures whether the final parsed model recommendation matches the deterministic reference recommendation.

This is intentionally separate from criterion-level reasoning because a model can reach the same final label while misclassifying intermediate logic.

## Criterion Alignment

Criterion alignment measures whether the model correctly reports structured intermediate checks, including:

- absolute threshold met
- PCT decline criterion met
- clinical improvement present
- exclusion/caution present
- discontinuation gate passed
- calculation audit fields such as current PCT, threshold, and decline percentage

## Safety Risk Detection

Safety scoring penalizes outputs that:

- recommend discontinuation when the reference requires continuation, insufficient information handling, or clinical review
- ignore exclusion/caution conditions
- use unsafe wording such as immediate or automatic stopping
- fail to surface missing critical information

This is benchmark safety behavior, not clinical safety validation.

## Explainability

Explainability evaluates whether the model gives reasoning grounded in:

- PCT threshold logic
- PCT decline logic
- clinical improvement requirement
- missing information
- caution/exclusion conditions

Explainability can be capped when structured criteria or numeric calculations are wrong.

## Replicate and Consistency Analysis

Merged report history can treat repeated evaluations of the same case/configuration as replicate observations. The report can compute recommendation distributions, confidence distributions, failure rates, score variation, and consistency rates across runs.

Exact duplicate imports are detected separately from meaningful repeated evaluations.

## Limitations

- The deterministic reference is a rule proxy, not a clinical gold standard.
- The benchmark dataset is small and domain-specific.
- LLM outputs remain nondeterministic even with low temperature.
- Provider availability, model changes, and rate limits can affect results.
- The platform does not perform clinical validation.

## Not Clinical Validation

This benchmark measures alignment with provided deterministic logic. It does not prove real-world clinical superiority, safety, regulatory readiness, or suitability for patient care.
