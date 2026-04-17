import type { SettingsAccess } from './instanceId.js'

export const GATED_SETTINGS = 'gated_settings'

/** Wraps Directus services to read/write our `gated_settings` key/value collection. */
export function makeSettings(itemsService: {
  readByQuery(q: { filter: { key: { _eq: string } } }): Promise<Array<{ id: string; key: string; value: string }>>
  createOne(p: { key: string; value: string }): Promise<{ id: string }>
  updateOne(id: string, p: { value: string }): Promise<void>
}): SettingsAccess {
  return {
    async get(key) {
      const rows = await itemsService.readByQuery({ filter: { key: { _eq: key } } })
      return rows[0]?.value ?? null
    },
    async set(key, value) {
      const rows = await itemsService.readByQuery({ filter: { key: { _eq: key } } })
      if (rows[0]) await itemsService.updateOne(rows[0].id, { value })
      else await itemsService.createOne({ key, value })
    },
  }
}
