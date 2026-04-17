// Re-export the canonical crawler list from the shared package.
// Keeping this thin wrapper means a single source of truth (Architectural Rule 1 spirit).
export { detectAgent, KNOWN_CRAWLERS } from '@gated/artifact-renderers'
