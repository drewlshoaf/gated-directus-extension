import { defineHook } from '@directus/extensions-sdk'

/**
 * Directus collection bootstrap.
 *
 * Free mode stores policy + settings + crawler events in Directus collections in
 * the customer's own DB. This hook creates those collections on first server init
 * if they don't already exist. Idempotent — safe to run on every restart.
 *
 * Collections created:
 *   gated_settings        — KV store. Keys we use today:
 *                             extension_instance_id   (lib/instanceId.ts)
 *                             activation_token        (the long-lived token from /activate/verify)
 *                             activation_last_ok_at   (lib/grace.ts — drives the 30-day rule)
 *                             project_node_id         (root node for free-mode resolution)
 *                             org_name, public_url    (used in /.well-known/ai)
 *   gated_policy_nodes    — free-mode tree (project → collection → item).
 *                             Architectural Rule 4: closest node wins.
 *   gated_policy_rules    — explicit rules attached to nodes.
 *                             Architectural Rule 3: UNIQUE(node_id, rule_type) — enforced
 *                             at the Directus uniqueness layer AND in the adapter.
 *   gated_crawler_events  — local crawler log, capped 30d/5k by trim.hook.ts.
 *
 * If you change a collection's shape, bump COLLECTION_SCHEMA_VERSION below; the
 * bootstrap will detect drift and patch additive changes (it will NOT drop columns
 * — destructive migrations require an explicit migration story).
 */

const COLLECTION_SCHEMA_VERSION = 2
const VERSION_KEY = 'collection_schema_version'

interface FieldDef {
  field: string
  type: string
  schema?: Record<string, unknown>
  meta?: Record<string, unknown>
}

interface CollectionDef {
  collection: string
  meta: Record<string, unknown>
  schema: Record<string, unknown>
  fields: FieldDef[]
}

const COLLECTIONS: CollectionDef[] = [
  {
    collection: 'gated_settings',
    meta: { hidden: false, singleton: false, icon: 'settings', note: 'Gated extension key/value settings' },
    schema: {},
    fields: [
      { field: 'id', type: 'uuid', schema: { is_primary_key: true, has_auto_increment: false, default_value: 'gen_random_uuid()' }, meta: { hidden: true, readonly: true } },
      { field: 'key', type: 'string', schema: { is_unique: true, is_nullable: false }, meta: { width: 'half', interface: 'input' } },
      { field: 'value', type: 'text', schema: { is_nullable: true }, meta: { width: 'full', interface: 'input-multiline' } },
    ],
  },
  {
    collection: 'gated_policy_nodes',
    meta: { hidden: false, icon: 'account_tree', note: 'Free-mode policy node tree (project → collection → item)' },
    schema: {},
    fields: [
      { field: 'id', type: 'uuid', schema: { is_primary_key: true, default_value: 'gen_random_uuid()' }, meta: { hidden: true, readonly: true } },
      { field: 'scope_type', type: 'string', schema: { is_nullable: false }, meta: { width: 'half', interface: 'select-dropdown', options: { choices: [{ text: 'project', value: 'project' }, { text: 'collection', value: 'collection' }, { text: 'item', value: 'item' }] } } },
      { field: 'scope_ref', type: 'string', schema: { is_nullable: true }, meta: { width: 'half', note: 'CMS reference (collection key, item id, etc.)' } },
      { field: 'parent_id', type: 'uuid', schema: { is_nullable: true }, meta: { width: 'half' } },
      { field: 'inherit', type: 'boolean', schema: { default_value: true, is_nullable: false }, meta: { width: 'half', interface: 'boolean' } },
      { field: 'created_at', type: 'timestamp', schema: { default_value: 'CURRENT_TIMESTAMP' }, meta: { hidden: true } },
    ],
  },
  {
    collection: 'gated_policy_rules',
    meta: { hidden: false, icon: 'rule', note: 'Explicit rules attached to policy nodes. UNIQUE (node_id, rule_type).' },
    schema: {},
    fields: [
      { field: 'id', type: 'uuid', schema: { is_primary_key: true, default_value: 'gen_random_uuid()' }, meta: { hidden: true, readonly: true } },
      { field: 'node_id', type: 'uuid', schema: { is_nullable: false }, meta: { width: 'half' } },
      { field: 'rule_type', type: 'string', schema: { is_nullable: false }, meta: { width: 'half' } },
      { field: 'value', type: 'string', schema: { is_nullable: false }, meta: { width: 'half' } },
      { field: 'metadata', type: 'json', schema: { is_nullable: true }, meta: { width: 'full', interface: 'input-code', options: { language: 'json' } } },
      { field: 'updated_at', type: 'timestamp', schema: { default_value: 'CURRENT_TIMESTAMP' }, meta: { hidden: true } },
    ],
  },
  {
    collection: 'gated_crawler_events',
    meta: { hidden: false, icon: 'travel_explore', note: 'Local AI crawler log. Free tier: capped 30 days / 5,000 events by scheduled trim.' },
    schema: {},
    fields: [
      { field: 'id', type: 'uuid', schema: { is_primary_key: true, default_value: 'gen_random_uuid()' }, meta: { hidden: true, readonly: true } },
      { field: 'user_agent', type: 'text', schema: { is_nullable: false } },
      { field: 'agent_name', type: 'string', schema: { is_nullable: false }, meta: { width: 'half' } },
      { field: 'path', type: 'string', schema: { is_nullable: false }, meta: { width: 'half' } },
      { field: 'method', type: 'string', schema: { is_nullable: false }, meta: { width: 'half' } },
      { field: 'observed_at', type: 'timestamp', schema: { is_nullable: false, default_value: 'CURRENT_TIMESTAMP' }, meta: { width: 'half' } },
      { field: 'compliance', type: 'string', schema: { is_nullable: true }, meta: { width: 'half', interface: 'select-dropdown', options: { choices: [{ text: 'allowed', value: 'allowed' }, { text: 'violation', value: 'violation' }] } } },
      { field: 'violation_reason', type: 'string', schema: { is_nullable: true }, meta: { width: 'half' } },
    ],
  },
]

export default defineHook(({ action }, { services, getSchema, database, logger }) => {
  // The 'server.start' action fires after the server boots and the schema is loaded.
  // Doing this work in 'init' would race the schema cache.
  action('server.start', async () => {
    try {
      await bootstrap(services, getSchema, database, logger)
    } catch (err) {
      // Architectural Rule 6: never break the host. If bootstrap fails, log loudly
      // but keep Directus running — the extension's endpoints fall back to bundled defaults.
      logger.error({ err }, 'gated: collection bootstrap failed; extension will run in fallback')
    }
  })
})

async function bootstrap(
  services: any,
  getSchema: () => Promise<any>,
  database: any,
  logger: any,
): Promise<void> {
  const schema = await getSchema()
  const CollectionsService = services.CollectionsService
  const FieldsService = services.FieldsService
  const ItemsService = services.ItemsService

  const collectionsSvc = new CollectionsService({ schema, knex: database })
  const fieldsSvc = new FieldsService({ schema, knex: database })

  // Load existing Gated collections.
  const existing: string[] = (await collectionsSvc.readByQuery())
    .filter((c: { collection: string }) => c.collection?.startsWith('gated_'))
    .map((c: { collection: string }) => c.collection)

  let created = 0
  let patched = 0

  for (const def of COLLECTIONS) {
    if (!existing.includes(def.collection)) {
      // Directus's createOne accepts the full collection definition with fields inline.
      await collectionsSvc.createOne({
        collection: def.collection,
        meta: def.meta,
        schema: def.schema,
        fields: def.fields,
      })
      created++
      logger.info(`gated: created collection ${def.collection}`)
    } else {
      // Patch missing fields additively. Never drop columns — that's a real migration.
      const presentFields = await fieldsSvc.readAll(def.collection)
      const presentNames = new Set(presentFields.map((f: { field: string }) => f.field))
      for (const field of def.fields) {
        if (!presentNames.has(field.field)) {
          await fieldsSvc.createField(def.collection, field)
          patched++
          logger.info(`gated: added field ${def.collection}.${field.field}`)
        }
      }
    }
  }

  // Refresh schema so the items service can see the new collections immediately.
  const freshSchema = await getSchema({ database, bypassCache: true })

  // Bootstrap a free-mode project policy node + a permissive default policy on first run.
  const settingsSvc = new ItemsService('gated_settings', { schema: freshSchema, knex: database })
  const nodesSvc = new ItemsService('gated_policy_nodes', { schema: freshSchema, knex: database })

  const versionRow = await settingsSvc.readByQuery({ filter: { key: { _eq: VERSION_KEY } }, limit: 1 })
  const projectRow = await settingsSvc.readByQuery({ filter: { key: { _eq: 'project_node_id' } }, limit: 1 })

  if (!projectRow[0]) {
    const projectNodeId = await nodesSvc.createOne({ scope_type: 'project', scope_ref: null, parent_id: null, inherit: true })
    await settingsSvc.createOne({ key: 'project_node_id', value: String(projectNodeId) })
    logger.info(`gated: seeded project policy node ${projectNodeId}`)
  }

  if (!versionRow[0]) {
    await settingsSvc.createOne({ key: VERSION_KEY, value: String(COLLECTION_SCHEMA_VERSION) })
  }

  if (created > 0 || patched > 0) {
    logger.info(`gated: bootstrap complete — created ${created} collection(s), patched ${patched} field(s)`)
  }
}
