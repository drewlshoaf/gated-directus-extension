import { defineEndpoint } from '@directus/extensions-sdk'
import { renderAiTxt } from '@gated/artifact-renderers'
import { resolveEffectivePolicy } from '@gated/policy-engine'
import { DirectusRuleStore } from '@gated/policy-engine/adapters/directus'
import { AI_TXT } from '../lib/fallback.js'
import { inFallback } from '../lib/grace.js'
import { makeSettings } from '../lib/settings.js'
import { directusClientFromServices } from './_shared.js'

export default defineEndpoint((router, { services, getSchema, database, logger }) => {
  router.get('/', async (_req, res) => {
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    try {
      const schema = await getSchema()
      const ItemsService = services.ItemsService
      const settings = makeSettings(new ItemsService('gated_settings', { schema, knex: database, accountability: null }))
      if (await inFallback(settings)) return res.send(AI_TXT)

      const projectNodeId = await settings.get('project_node_id')
      if (!projectNodeId) return res.send(AI_TXT)

      const adapter = new DirectusRuleStore(directusClientFromServices(services, schema, database))
      const projectPolicy = await resolveEffectivePolicy(adapter, projectNodeId, 'project')

      // Resolve collection-level policies for per-path sections.
      const nodesSvc = new ItemsService('gated_policy_nodes', { schema, knex: database, accountability: null })
      const collectionNodes: Array<{ id: string; scope_ref: string }> = await nodesSvc.readByQuery({
        filter: { _and: [{ parent_id: { _eq: projectNodeId } }, { scope_type: { _eq: 'collection' } }] },
        limit: 500,
      })

      const collectionPolicies = await Promise.all(
        collectionNodes.map(n => resolveEffectivePolicy(adapter, n.id, 'collection'))
      )

      const collectionPaths: Record<string, string> = {}
      for (const n of collectionNodes) {
        collectionPaths[n.id] = `/items/${n.scope_ref}/`
      }

      // Resolve item-level policies for each collection that has item nodes.
      const itemPolicies: typeof collectionPolicies = []
      const itemPaths: Record<string, string> = {}
      for (const cn of collectionNodes) {
        const itemNodes: Array<{ id: string; scope_ref: string }> = await nodesSvc.readByQuery({
          filter: { _and: [{ parent_id: { _eq: cn.id } }, { scope_type: { _eq: 'item' } }] },
          limit: 500,
        })
        for (const itemNode of itemNodes) {
          const itemPolicy = await resolveEffectivePolicy(adapter, itemNode.id, 'item')
          itemPolicies.push(itemPolicy)
          itemPaths[itemNode.id] = `/items/${cn.scope_ref}/${itemNode.scope_ref}`
        }
      }

      return res.send(renderAiTxt(
        projectPolicy,
        [...collectionPolicies, ...itemPolicies],
        { ...collectionPaths, ...itemPaths },
      ))
    } catch (err) {
      logger.warn({ err }, 'gated: ai.txt error → fallback')
      return res.send(AI_TXT)
    }
  })
})
