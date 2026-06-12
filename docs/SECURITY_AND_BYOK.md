# Security and BYOK

This document describes the MVP security model. It is not a production security design.

## BYOK Concept

BYOK means "bring your own key." Users can connect provider API keys for OpenRouter or Groq so the app can call selected models during evaluation.

## Where Keys Are Stored in the MVP

In the current MVP, provider keys entered through the UI are stored in browser `sessionStorage` under `providerApiKeys`.

The API key is sent to Next.js API routes only for the current provider request. The app does not intentionally store provider keys in a database, filesystem, or server memory.

## Export and Import Safety

Workspace export/import intentionally excludes:

- provider API keys
- auth tokens
- bearer tokens
- browser-session provider key state

Import helpers detect API-key-like fields and warn that those fields are ignored.

## No Production PHI Handling

The MVP is not designed for protected health information or real patient records. Case data is stored in browser storage and may be included in exported workspace files if the user exports a workspace.

Do not enter real patient data.

## No Database or Auth in MVP

The current prototype has:

- no authentication
- no authorization model
- no server-side database
- no encrypted server-side key vault
- no production audit logs

## Production Requirements

A production version would require:

- authentication and authorization
- encrypted server-side key storage or delegated provider authorization
- secure secret handling and rotation
- server-side database with appropriate access controls
- audit logs for prompts, workflows, criteria, runs, imports, and exports
- data retention controls
- privacy and security review
- PHI handling review if used in healthcare contexts
- explicit compliance and regulatory assessment where applicable
