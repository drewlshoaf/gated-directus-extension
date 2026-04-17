/**
 * Bundled fallback artifacts.
 *
 * Architectural Rule 6 — never break the customer's live site.
 * After 30 days of failed activation/status verification we serve THESE STATIC STRINGS
 * (not dynamically generated). robots.txt / ai.txt / well-known/ai never 404.
 *
 * The strings come from @gated/artifact-renderers/defaults — single source of truth.
 */
export {
  DEFAULT_ROBOTS_TXT as ROBOTS_TXT,
  DEFAULT_AI_TXT as AI_TXT,
  DEFAULT_WELL_KNOWN_AI as WELL_KNOWN_AI,
} from '@gated/artifact-renderers'

export const GRACE_PERIOD_DAYS = 30
