# Limitations

This project is a prototype benchmark platform. It is not a production clinical or enterprise evaluation system.

## Clinical and Domain Limitations

- No clinical validation has been performed.
- Deterministic PCT reference logic is only a proxy for benchmark scoring.
- The PCT case study is not a clinical gold standard.
- The app must not be used for real patient decisions.
- Benchmark cases may omit context that would matter in real clinical practice.

## Data and Persistence Limitations

- No server-side database.
- Browser-local persistence through `localStorage` and `sessionStorage`.
- Workspace exports may contain case data entered by the user.
- No production PHI handling.
- No authentication or authorization.

## Provider and Runtime Limitations

- Provider rate limits can affect batch benchmark runs.
- Model availability can change outside the app.
- Free/on-demand provider tiers may fail or throttle requests.
- Large benchmark runs may hit serverless timeout limits.
- Long-running jobs are not currently handled by background workers.

## Evaluation Limitations

- LLM outputs are nondeterministic.
- JSON parsing can fail when models do not follow the expected schema.
- Mock/demo fallback states may appear when no live run is available.
- Scoring formulas are deterministic but still reflect chosen benchmark assumptions.
- Replicate consistency measures repeatability, not clinical confidence.

## Dataset Limitations

- The built-in benchmark case library is small.
- Some cases are adapted or synthetic.
- Thermo Fisher adapted cases are used for realism but are not complete clinical records; no affiliation or endorsement is implied.
- Synthetic cases are useful for rule coverage but do not represent real-world data diversity.
