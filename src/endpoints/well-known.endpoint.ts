import { defineEndpoint } from '@directus/extensions-sdk'
import { renderWellKnownAi } from '@gated/artifact-renderers'
import { resolveEffectivePolicy } from '@gated/policy-engine'
import { DirectusRuleStore } from '@gated/policy-engine/adapters/directus'
import { WELL_KNOWN_AI } from '../lib/fallback.js'
import { inFallback } from '../lib/grace.js'
import { makeSettings } from '../lib/settings.js'
import { directusClientFromServices } from './_shared.js'

export default defineEndpoint((router, { services, getSchema, database, logger }) => {
  router.get('/ai', async (_req, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8')
    try {
      const schema = await getSchema()
      const ItemsService = services.ItemsService
      const settings = makeSettings(new ItemsService('gated_settings', { schema, knex: database, accountability: null }))
      if (await inFallback(settings)) return res.send(WELL_KNOWN_AI)

      const projectNodeId = await settings.get('project_node_id')
      if (!projectNodeId) return res.send(WELL_KNOWN_AI)

      const adapter = new DirectusRuleStore(directusClientFromServices(services, schema, database))
      const policy = await resolveEffectivePolicy(adapter, projectNodeId, 'project')
      const orgName = (await settings.get('org_name')) ?? 'unknown'
      const baseUrl = (await settings.get('public_url')) ?? ''
      return res.send(renderWellKnownAi(policy, [], { name: orgName }, { base_url: baseUrl }))
    } catch (err) {
      logger.warn({ err }, 'gated: /.well-known/ai error → fallback')
      return res.send(WELL_KNOWN_AI)
    }
  })
})
