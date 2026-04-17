import { defineHook } from '@directus/extensions-sdk'
import { detectAgent } from '../lib/crawlers'
import { resolveEffectivePolicy } from '@gated/policy-engine'
import { DirectusRuleStore } from '@gated/policy-engine/adapters/directus'
import { directusClientFromServices } from '../endpoints/_shared.js'

/**
 * Express middleware that inspects every inbound HTTP request, detects known AI
 * crawlers from the User-Agent, and writes a row to gated_crawler_events
 * including a compliance assessment.
 *
 * Compliance logic:
 *   - If the path matches /items/<collection>, resolve that collection's policy.
 *   - If retrieval is denied or access_class is restricted → 'violation'
 *   - Otherwise → 'allowed'
 *   - Non-item paths (admin, assets, etc.) → 'allowed' (not gated content)
 */
export default defineHook(({ init }, { services, getSchema, database, logger }) => {
  init('middlewares.before', ({ app }) => {
    app.use(async (req: any, _res: any, next: any) => {
      // Skip admin static assets — high volume, no signal.
      if (req.url?.startsWith('/admin/assets/')) return next()

      const ua = req.headers?.['user-agent'] ?? ''
      const agent = detectAgent(String(ua))
      if (!agent) return next()

      const path = String(req.url ?? '/').slice(0, 1024)

      // Determine compliance by resolving the most specific policy node:
      // item > collection > project
      let compliance = 'allowed'
      let violationReason: string | null = null
      try {
        const itemMatch = /^\/items\/([^/?]+)\/([^/?]+)/.exec(path)
        const collectionMatch = /^\/items\/([^/?]+)/.exec(path)
        const collection = (itemMatch ?? collectionMatch)?.[1]
        const itemId = itemMatch?.[2] ?? null

        if (collection && !collection.startsWith('directus_') && !collection.startsWith('gated_')) {
          const schema = await getSchema()
          const ItemsService = services.ItemsService
          const adapter = new DirectusRuleStore(directusClientFromServices(services, schema, database))
          const nodesSvc = new ItemsService('gated_policy_nodes', { schema, knex: database, accountability: null })

          // Find collection node
          const collRows = await nodesSvc.readByQuery({
            filter: { scope_type: { _eq: 'collection' }, scope_ref: { _eq: collection } },
            limit: 1,
          })
          const collectionNodeId = collRows[0]?.id as string | undefined

          // If requesting a specific item, check for an item-level node
          let resolvedNodeId: string | undefined
          let resolvedScope: 'item' | 'collection' | 'project' = 'project'

          if (itemId && collectionNodeId) {
            const itemRows = await nodesSvc.readByQuery({
              filter: { _and: [{ parent_id: { _eq: collectionNodeId } }, { scope_type: { _eq: 'item' } }, { scope_ref: { _eq: itemId } }] },
              limit: 1,
            })
            if (itemRows[0]?.id) {
              resolvedNodeId = itemRows[0].id as string
              resolvedScope = 'item'
            }
          }

          // Fall back to collection node
          if (!resolvedNodeId && collectionNodeId) {
            resolvedNodeId = collectionNodeId
            resolvedScope = 'collection'
          }

          // Fall back to project node
          if (!resolvedNodeId) {
            const settingsSvc = new ItemsService('gated_settings', { schema, knex: database, accountability: null })
            const projRows = await settingsSvc.readByQuery({
              filter: { key: { _eq: 'project_node_id' } },
              limit: 1,
            })
            if (projRows[0]?.value) {
              resolvedNodeId = projRows[0].value as string
              resolvedScope = 'project'
            }
          }

          if (resolvedNodeId) {
            const policy = await resolveEffectivePolicy(adapter, resolvedNodeId, resolvedScope)
            const accessClass = policy.rules.access_class?.value
            const denyRetrieval = policy.rules.allow_retrieval?.value === 'deny'
            const denyTraining = policy.rules.allow_training?.value === 'deny'
            // Build violation reasons
            const reasons: string[] = []
            if (denyRetrieval) reasons.push('retrieval denied')
            if (denyTraining) reasons.push('training denied')
            if (accessClass === 'restricted') reasons.push('access class is restricted — requires authorization')
            if (accessClass === 'licensed') reasons.push('access class is licensed — requires license agreement')
            if (reasons.length > 0) {
              compliance = 'violation'
              violationReason = `${resolvedScope} policy: ${reasons.join('; ')}`
            }
          }
        }
      } catch (err) {
        logger.warn({ err }, 'gated: compliance check failed — defaulting to allowed')
      }

      const eventData = {
        user_agent: String(ua).slice(0, 1024),
        agent_name: agent,
        path,
        method: String(req.method ?? 'GET'),
        observed_at: new Date().toISOString(),
        compliance,
        violation_reason: violationReason,
      }

      // Write to local Directus collection
      try {
        const schema = await getSchema()
        const ItemsService = services.ItemsService
        const items = new ItemsService('gated_crawler_events', { schema, knex: database, accountability: null })
        await items.createOne(eventData)
      } catch (err) {
        logger.warn({ err }, 'gated: failed to log crawler event locally')
      }

      // Sync to hosted control plane if API key is set (connected mode)
      try {
        const schema = await getSchema()
        const ItemsService = services.ItemsService
        const settingsSvc = new ItemsService('gated_settings', { schema, knex: database, accountability: null })
        const rows = await settingsSvc.readByQuery({ filter: { key: { _eq: 'gated_api_key' } }, limit: 1 })
        const apiKey = rows[0]?.value as string | undefined
        if (apiKey) {
          const orgRows = await settingsSvc.readByQuery({ filter: { key: { _eq: 'gated_org_id' } }, limit: 1 })
          const orgId = orgRows[0]?.value as string | undefined
          if (orgId) {
            const apiBase = process.env.GATED_API_BASE_URL ?? 'http://api:3000'
            fetch(`${apiBase}/api/v1/orgs/${orgId}/ingest/crawler-event`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
              body: JSON.stringify(eventData),
            }).catch(err => logger.warn({ err }, 'gated: failed to sync crawler event to control plane'))
          }
        }
      } catch {
        // Non-critical — don't block the request
      }

      next()
    })
  })
})
