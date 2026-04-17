import { defineHook } from '@directus/extensions-sdk'
import { ActivationClient } from '../lib/activationClient.js'
import { makeSettings } from '../lib/settings.js'
import { markActivationOk } from '../lib/grace.js'

/**
 * Calls /activate/status weekly to keep the activation_token alive and update grace timer.
 * On failure, exponential backoff retry — never throws into Directus.
 */
export default defineHook(({ schedule }, { services, getSchema, logger }) => {
  // Every Sunday at 03:00.
  schedule('0 3 * * 0', async () => {
    try {
      const schema = await getSchema()
      const ItemsService = services.ItemsService
      const items = new ItemsService('gated_settings', { schema, accountability: null })
      const settings = makeSettings(items)

      const token = await settings.get('activation_token')
      if (!token) return

      const client = new ActivationClient(process.env.GATED_API_BASE ?? 'https://api.gated.fyi')
      const status = await client.status(token)
      if (status.active) await markActivationOk(settings)
    } catch (err) {
      logger.warn({ err }, 'gated: weekly activation status check failed; backoff retry')
    }
  })
})
