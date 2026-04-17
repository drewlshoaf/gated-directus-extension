import { defineEndpoint } from '@directus/extensions-sdk'
import { renderRobotsTxt } from '@gated/artifact-renderers'
import { resolveEffectivePolicy } from '@gated/policy-engine'
import { DirectusRuleStore } from '@gated/policy-engine/adapters/directus'
import { ROBOTS_TXT, GRACE_PERIOD_DAYS } from '../lib/fallback.js'
import { inFallback } from '../lib/grace.js'
import { makeSettings } from '../lib/settings.js'
import { directusClientFromServices } from './_shared.js'

/**
 * Serves /robots.txt from the Directus extension.
 * Architectural Rule 6: never 404. Two layers of safety:
 *   1. If the customer hasn't configured policy yet → render permissive default.
 *   2. If activation is unreachable for >30 days → serve bundled fallback (deny-AI).
 */
export default defineEndpoint((router, { services, getSchema, database, logger }) => {
  router.get('/', async (_req, res) => {
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    try {
      const schema = await getSchema()
      const ItemsService = services.ItemsService
      const settings = makeSettings(new ItemsService('gated_settings', { schema, knex: database, accountability: null }))
      if (await inFallback(settings)) {
        res.setHeader('x-gated-mode', 'fallback')
        return res.send(ROBOTS_TXT)
      }

      const adapter = new DirectusRuleStore(directusClientFromServices(services, schema, database))
      const projectNodeId = (await settings.get('project_node_id')) ?? null
      if (!projectNodeId) {
        return res.send('User-agent: *\nAllow: /\n')
      }
      const projectPolicy = await resolveEffectivePolicy(adapter, projectNodeId, 'project')

      // Resolve collection-level policies for per-path rules in robots.txt.
      const nodesSvc = new ItemsService('gated_policy_nodes', { schema, knex: database, accountability: null })
      const collectionNodes: Array<{ id: string; scope_ref: string }> = await nodesSvc.readByQuery({
        filter: { _and: [{ parent_id: { _eq: projectNodeId } }, { scope_type: { _eq: 'collection' } }] },
        limit: 500,
      })

      const collectionPolicies = await Promise.all(
        collectionNodes.map(n => resolveEffectivePolicy(adapter, n.id, 'collection'))
      )

      // Map collection node IDs to Directus content paths.
      // Directus serves items at /items/<collection>/ so that's the path to block.
      const collectionPaths: Record<string, string> = {}
      for (const n of collectionNodes) {
        collectionPaths[n.id] = `/items/${n.scope_ref}/`
      }

      return res.send(renderRobotsTxt(projectPolicy, collectionPolicies, collectionPaths))
    } catch (err) {
      logger.warn({ err, GRACE_PERIOD_DAYS }, 'gated: robots.txt error → serving bundled fallback')
      res.setHeader('x-gated-mode', 'fallback-error')
      return res.send(ROBOTS_TXT)
    }
  })
})
