# @gated/directus-extension

MIT-licensed. Dual-mode Directus extension for AI content rights and retrieval control.

## Modes

- **Free / standalone** — no `GATED_API_KEY`. Embeds `@gated/policy-engine` with a `DirectusRuleStore`. Policy in `gated_policy_*` collections in your Directus DB. Artifacts (`/robots.txt`, `/ai.txt`, `/.well-known/ai`) generated and served from this extension's endpoints.
- **Connected / paid** — set `GATED_API_KEY` in extension settings. Becomes a thin sync client to the hosted control plane.

## MIT boundary

This package is MIT-licensed. It MUST NOT import from any `@gated/*` package outside of `@gated/types`, `@gated/policy-engine`, `@gated/artifact-renderers` (which are also boundary-safe). CI enforces this — see `scripts/check-mit-boundary.mjs` at the monorepo root.

## Survives offline

Activation server unreachable → exponential backoff retry. After 30 days of failed verification → bundled fallback artifacts in `lib/fallback.ts` + admin warning banner. `robots.txt` never returns 404.
