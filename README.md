# @gated/directus-extension

MIT-licensed. Dual-mode Directus extension for AI content rights and retrieval control.

## Installation

Requires Directus `^10.0.0` and Node 18+.

### From source

1. Install and build:
   ```sh
   npm install
   npm run build
   ```
   This produces [dist/app.js](dist/app.js) and [dist/api.js](dist/api.js), per the bundle entry in [package.json:7-12](package.json#L7-L12).

2. Copy the extension into your Directus project's `extensions/` directory:
   ```sh
   cp -r . /path/to/directus/extensions/gated-directus-extension
   ```
   Only `package.json` and `dist/` are needed at runtime — `src/`, `node_modules/`, and dev files can be omitted.

3. Restart Directus. The module, endpoints, and hooks declared in [package.json:13-64](package.json#L13-L64) will load automatically.

### Configure the mode

- **Free / standalone** — leave `GATED_API_KEY` unset. Policy is stored in `gated_policy_*` collections in your Directus DB.
- **Connected / paid** — set `GATED_API_KEY` in the extension settings to sync with the hosted control plane.

### Development

```sh
npm run dev        # watch-mode build
npm run typecheck  # tsc --noEmit
```

## Modes

- **Free / standalone** — no `GATED_API_KEY`. Embeds `@gated/policy-engine` with a `DirectusRuleStore`. Policy in `gated_policy_*` collections in your Directus DB. Artifacts (`/robots.txt`, `/ai.txt`, `/.well-known/ai`) generated and served from this extension's endpoints.
- **Connected / paid** — set `GATED_API_KEY` in extension settings. Becomes a thin sync client to the hosted control plane.

## MIT boundary

This package is MIT-licensed. It MUST NOT import from any `@gated/*` package outside of `@gated/types`, `@gated/policy-engine`, `@gated/artifact-renderers` (which are also boundary-safe). CI enforces this — see `scripts/check-mit-boundary.mjs` at the monorepo root.

## Survives offline

Activation server unreachable → exponential backoff retry. After 30 days of failed verification → bundled fallback artifacts in `lib/fallback.ts` + admin warning banner. `robots.txt` never returns 404.
