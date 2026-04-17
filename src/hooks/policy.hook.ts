import { defineHook } from '@directus/extensions-sdk'
import { resolveEffectivePolicy } from '@gated/policy-engine'
import { DirectusRuleStore } from '@gated/policy-engine/adapters/directus'
import { TtlCache } from '../lib/cache.js'
import { directusClientFromServices } from '../endpoints/_shared.js'

/**
 * Phase 3 governed-access enforcement hook (Step 27).
 *
 * Binds to the `items.read` filter. For collections whose resolved policy has
 * `access_class: restricted`, the hook requires the incoming request to carry
 * a Gated-issued access-token JWT and be approved by GET /auth/verify.
 *
 * Rule 6 posture — safe mode:
 *   - Missing token                 → 403 + Link header for recovery.
 *   - /auth/verify returns deny     → 403 + Link header.
 *   - /auth/verify unreachable      → 403 + Link header (fail CLOSED for
 *     restricted content) but log loudly. Rationale: for restricted content
 *     a Gated outage and a legitimate deny look the same to the crawler, and
 *     the Link header gives it an explicit recovery path. We would rather
 *     over-protect than under-protect restricted material.
 *   - Collection is NOT restricted  → pass through unchanged. The free-mode
 *     artifact path (robots.txt / ai.txt) already handles public/licensed.
 *
 * Allow-decisions are cached locally for 30s to keep the hot path cheap —
 * the control plane caches for 5 min, the edge for 30 s.
 *
 * Architectural notes:
 *   - This hook is MIT-boundary-safe: it only uses @gated/policy-engine,
 *     @gated/types (via the engine), and fetch. No proprietary imports.
 *   - The policy tree in free mode is project → collection → item. We address
 *     collections by their `gated_policy_nodes.id` (scope_type='collection'),
 *     resolving the scope_ref from the request's collection name.
 */

interface AllowDecision {
  ok: true
  grant_id?: string
  expires_at?: string
}
interface DenyDecision {
  ok: false
  status: number
  link?: string
  reason: string
}
type Decision = AllowDecision | DenyDecision

const API_BASE = process.env.GATED_API_BASE_URL ?? 'https://api.gated.fyi'
const VERIFY_URL = `${API_BASE.replace(/\/+$/, '')}/auth/verify`
const LINK_HEADER = `<${API_BASE.replace(/\/+$/, '')}/access-requests>; rel="request-access"`

// 30s allow cache. Key: `${bearerHash}|${scopeType}/${scopeId}`.
const allowCache = new TtlCache<AllowDecision>(30_000)

// Trim header values at a safe length for log lines; never crash on junk.
function safeString(v: unknown, max = 200): string {
  if (typeof v !== 'string') return ''
  return v.length > max ? v.slice(0, max) : v
}

/**
 * Resolve a collection's policy node id from the `gated_policy_nodes`
 * collection. Mirrors the shape DirectusRuleStore expects — scope_ref is the
 * Directus collection name for collection-scoped nodes.
 */
async function resolveCollectionNodeId(
  itemsService: { readByQuery: (q: unknown) => Promise<Array<{ id: string }>> },
  collectionName: string,
): Promise<string | null> {
  const rows = await itemsService.readByQuery({
    filter: { scope_type: { _eq: 'collection' }, scope_ref: { _eq: collectionName } },
    limit: 1,
  })
  return rows[0]?.id ?? null
}

async function callVerify(
  jwt: string,
  scope: string,
  logger: { warn: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void },
): Promise<Decision> {
  // Short network budget — /auth/verify is a p99 < 50ms endpoint, but we're
  // on a customer-hosted Directus that may have flaky egress. 2s ceiling
  // keeps any reverse proxy from tripping its own timeouts.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-gated-resource': scope,
        'x-gated-connector': 'directus-extension',
      },
      signal: controller.signal,
    })
    if (res.status === 503) {
      logger.warn({ status: 503 }, 'gated: /auth/verify responded 503 — failing closed')
      return { ok: false, status: 403, link: LINK_HEADER, reason: 'verify_unavailable' }
    }
    if (!res.ok) {
      logger.warn({ status: res.status }, 'gated: /auth/verify responded non-2xx')
      return { ok: false, status: 403, link: LINK_HEADER, reason: `verify_http_${res.status}` }
    }
    const body = (await res.json()) as {
      decision?: unknown
      reason?: unknown
      grant_id?: unknown
      expires_at?: unknown
    }
    if (body.decision === 'allow') {
      const out: AllowDecision = { ok: true }
      if (typeof body.grant_id === 'string') out.grant_id = body.grant_id
      if (typeof body.expires_at === 'string') out.expires_at = body.expires_at
      return out
    }
    return {
      ok: false,
      status: 403,
      link: LINK_HEADER,
      reason: typeof body.reason === 'string' ? body.reason : 'denied',
    }
  } catch (err) {
    // Network failure / timeout / DNS. SAFE MODE = fail CLOSED with the
    // recovery Link header. Log loud so customers see the Gated outage in
    // their own Directus logs.
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'gated: /auth/verify unreachable — failing closed')
    return { ok: false, status: 403, link: LINK_HEADER, reason: 'verify_unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

export default defineHook(({ filter }, { services, getSchema, database, logger }) => {
  // Directus v10+ 'items.read' filter runs BEFORE the read is executed. The
  // hook signature is (payload, meta, context). Returning throws Forbidden
  // blocks the read with a 403 to the caller.
  //
  // We deliberately do not mutate the payload — this is pre-read, so there
  // is nothing to redact. We either pass or throw.
  filter('items.read', async (payload: unknown, meta: unknown, context: unknown) => {
    // `meta.collection` is the Directus collection key. We only gate
    // customer content; skip our own bookkeeping tables and system tables.
    const collection = (meta as { collection?: string } | null)?.collection
    if (!collection) return payload
    if (collection.startsWith('directus_') || collection.startsWith('gated_')) {
      return payload
    }

    const req = (context as { req?: { headers?: Record<string, unknown> } } | null)?.req
    const headers = req?.headers ?? {}

    let schema: unknown
    try {
      schema = await getSchema()
    } catch (err) {
      logger.warn({ err }, 'gated: getSchema failed in policy.hook — passing through')
      return payload
    }
    const ItemsService = services.ItemsService

    // Resolve the policy for the collection. If it's not restricted we do
    // nothing — free-mode public/licensed reads aren't gated at the item
    // level today.
    let accessClass: string | undefined
    let collectionNodeId: string | null = null
    try {
      const nodesSvc = new ItemsService('gated_policy_nodes', { schema, knex: database, accountability: null })
      collectionNodeId = await resolveCollectionNodeId(nodesSvc, collection)
      if (!collectionNodeId) return payload

      const adapter = new DirectusRuleStore(directusClientFromServices(services, schema, database))
      const policy = await resolveEffectivePolicy(adapter, collectionNodeId, 'collection')
      accessClass = (policy.rules.access_class?.value as string | undefined) ?? undefined
    } catch (err) {
      // If we can't even resolve the policy, we can't know whether to gate.
      // Safe default: pass through (free-mode Rule 6 — never break the live
      // site). If it WAS restricted we'd rather log than wrongly deny.
      logger.warn({ err, collection }, 'gated: policy resolve failed in hook — passing through')
      return payload
    }

    if (accessClass !== 'restricted') return payload

    // ── Restricted path ─────────────────────────────────────────────────
    const auth = safeString(headers.authorization)
    const m = /^Bearer\s+(.+)$/i.exec(auth)
    if (!m) {
      return denyWithLink('missing_token', req)
    }
    const jwt = m[1]!
    const scope = `collection/${collectionNodeId}`
    const cacheKey = `${jwt}|${scope}`

    const cached = allowCache.get(cacheKey)
    if (cached) return payload

    const decision = await callVerify(jwt, scope, logger)
    if (decision.ok) {
      allowCache.set(cacheKey, decision)
      return payload
    }
    return denyWithLink(decision.reason, req)
  })
})

/**
 * Attach the recovery Link header to the response (if accessible) and throw
 * a Forbidden error that Directus surfaces as a 403 to the crawler.
 */
function denyWithLink(reason: string, req: unknown): never {
  // Best-effort header injection. `context.req.res` is Directus-internal but
  // Express-y; we don't rely on it but try to decorate before throwing.
  try {
    const res = (req as { res?: { setHeader?: (k: string, v: string) => void } } | undefined)?.res
    res?.setHeader?.('Link', LINK_HEADER)
    res?.setHeader?.('X-Gated-Deny-Reason', reason)
  } catch {
    // ignore — the throw below is the load-bearing part
  }
  // `code: 'FORBIDDEN'` is how Directus's ForbiddenException maps; we don't
  // import the class to stay runtime-light and avoid SDK version coupling.
  const err = new Error(`Gated policy denied: ${reason}`) as Error & { status?: number; code?: string }
  err.status = 403
  err.code = 'FORBIDDEN'
  throw err
}
