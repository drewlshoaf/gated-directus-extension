import { defineHook } from '@directus/extensions-sdk'
import { resolveEffectivePolicy } from '@gated/policy-engine'
import { DirectusRuleStore } from '@gated/policy-engine/adapters/directus'
import { buildResponseHeaders } from '@gated/artifact-renderers'
import { directusClientFromServices } from '../endpoints/_shared.js'

/**
 * Injects X-Robots-Tag and Link headers into /items/<collection> and
 * /items/<collection>/<item> responses based on the resolved policy.
 *
 * Resolves the most specific policy node: item > collection > project.
 */
export default defineHook(({ init }, { services, getSchema, database, logger }) => {
  init('middlewares.before', ({ app }) => {
    app.use(async (req: any, res: any, next: any) => {
      if (req.method !== 'GET') return next()

      const itemMatch = /^\/items\/([^/?]+)\/([^/?]+)/.exec(req.url ?? '')
      const collectionMatch = /^\/items\/([^/?]+)/.exec(req.url ?? '')
      const collection = (itemMatch ?? collectionMatch)?.[1]
      const itemId = itemMatch?.[2] ?? null

      if (!collection) return next()
      if (collection.startsWith('directus_') || collection.startsWith('gated_')) return next()

      try {
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

        let resolvedNodeId: string | undefined
        let resolvedScope: 'item' | 'collection' | 'project' = 'project'

        // Check for item-level node
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

        // Fall back to collection
        if (!resolvedNodeId && collectionNodeId) {
          resolvedNodeId = collectionNodeId
          resolvedScope = 'collection'
        }

        // Fall back to project
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
          const headers = buildResponseHeaders(policy.rules)
          for (const [k, v] of Object.entries(headers)) {
            res.setHeader(k, v)
          }
        }
      } catch (err) {
        logger.warn({ err, collection }, 'gated: header injection failed — passing through')
      }

      next()
    })
  })
})
