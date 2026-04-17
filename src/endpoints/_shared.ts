import type { DirectusClient } from '@gated/policy-engine/adapters/directus'

/** Adapt Directus's ItemsService surface to the minimal DirectusClient our adapter wants. */
export function directusClientFromServices(
  services: { ItemsService: new (collection: string, opts: Record<string, unknown>) => any },
  schema: unknown,
  database?: unknown,
): DirectusClient {
  function svc(collection: string) {
    return new services.ItemsService(collection, { schema, knex: database, accountability: null })
  }
  return {
    async readByQuery(collection, query) {
      return svc(collection).readByQuery(query)
    },
    async createOne(collection, payload) {
      const id = await svc(collection).createOne(payload)
      return { id: String(id) }
    },
    async updateOne(collection, id, payload) {
      await svc(collection).updateOne(id, payload)
    },
    async deleteOne(collection, id) {
      await svc(collection).deleteOne(id)
    },
  }
}
