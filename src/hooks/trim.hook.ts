import { defineHook } from '@directus/extensions-sdk'

/**
 * Free-tier crawler-log cap: 30 days OR 5,000 most recent events, whichever is more aggressive.
 * Per the business plan §"Free Tier" and CLAUDE.md §"Pricing".
 *
 * Runs hourly. Idempotent. The cap-hit banner (upsell surface #1) is the dashboard's
 * job; this hook just keeps the table small.
 */
const FREE_TIER_MAX_DAYS = 30
const FREE_TIER_MAX_EVENTS = 5000

export default defineHook(({ schedule }, { services, getSchema, database, logger }) => {
  // Top of every hour.
  schedule('0 * * * *', async () => {
    try {
      const schema = await getSchema()
      const ItemsService = services.ItemsService
      const events = new ItemsService('gated_crawler_events', { schema, knex: database })

      // Drop anything older than 30 days.
      const cutoff = new Date(Date.now() - FREE_TIER_MAX_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const oldIds = await events.readByQuery({
        filter: { observed_at: { _lt: cutoff } },
        fields: ['id'],
        limit: -1,
      })
      if (oldIds.length > 0) {
        await events.deleteMany(oldIds.map((r: { id: string }) => r.id))
        logger.info(`gated: trimmed ${oldIds.length} crawler events older than ${FREE_TIER_MAX_DAYS}d`)
      }

      // Then enforce the 5k cap by deleting oldest beyond the limit.
      const total = await events.readByQuery({ aggregate: { count: ['id'] } })
      const count = Number(total?.[0]?.count?.id ?? 0)
      if (count > FREE_TIER_MAX_EVENTS) {
        const excess = count - FREE_TIER_MAX_EVENTS
        const surplus = await events.readByQuery({
          sort: ['observed_at'],
          fields: ['id'],
          limit: excess,
        })
        if (surplus.length > 0) {
          await events.deleteMany(surplus.map((r: { id: string }) => r.id))
          logger.info(`gated: trimmed ${surplus.length} crawler events to enforce ${FREE_TIER_MAX_EVENTS} cap`)
        }
      }
    } catch (err) {
      logger.warn({ err }, 'gated: crawler trim failed (will retry next hour)')
    }
  })
})
