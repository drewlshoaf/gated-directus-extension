import { useApi } from '@directus/extensions-sdk'

/**
 * Tiny wrappers over Directus's `useApi()` axios instance for our gated_* collections.
 * Composables, not classes — caller controls reactivity.
 */

export interface GatedSetting { id: string; key: string; value: string | null }
export interface PolicyNode { id: string; scope_type: string; scope_ref: string | null; parent_id: string | null; inherit: boolean }
export interface PolicyRule { id: string; node_id: string; rule_type: string; value: string; metadata: Record<string, unknown> | null }
export interface CrawlerEvent { id: string; user_agent: string; agent_name: string; path: string; method: string; observed_at: string; compliance: string | null; violation_reason: string | null }

export function useGatedApi() {
  const api = useApi()

  return {
    // ── Settings KV ────────────────────────────────────────────────
    async getSetting(key: string): Promise<string | null> {
      const r = await api.get('/items/gated_settings', { params: { filter: { key: { _eq: key } }, limit: 1 } })
      return (r.data?.data?.[0]?.value as string | null) ?? null
    },
    async setSetting(key: string, value: string): Promise<void> {
      const existing = await api.get('/items/gated_settings', { params: { filter: { key: { _eq: key } }, limit: 1 } })
      const row = existing.data?.data?.[0] as GatedSetting | undefined
      if (row) await api.patch(`/items/gated_settings/${row.id}`, { value })
      else await api.post('/items/gated_settings', { key, value })
    },

    // ── Policy nodes / rules ───────────────────────────────────────
    async getProjectNode(): Promise<PolicyNode | null> {
      const id = await this.getSetting('project_node_id')
      if (!id) return null
      const r = await api.get(`/items/gated_policy_nodes/${id}`)
      return r.data?.data ?? null
    },
    async listRules(nodeId: string): Promise<PolicyRule[]> {
      const r = await api.get('/items/gated_policy_rules', { params: { filter: { node_id: { _eq: nodeId } }, limit: 200 } })
      return r.data?.data ?? []
    },
    /** Architectural Rule 3 — UNIQUE(node_id, rule_type). Update existing, never insert duplicate. */
    async upsertRule(nodeId: string, ruleType: string, value: string, metadata: Record<string, unknown> | null = null): Promise<void> {
      const existing = await api.get('/items/gated_policy_rules', {
        params: { filter: { _and: [{ node_id: { _eq: nodeId } }, { rule_type: { _eq: ruleType } }] }, limit: 1 },
      })
      const row = existing.data?.data?.[0] as PolicyRule | undefined
      if (row) {
        await api.patch(`/items/gated_policy_rules/${row.id}`, { value, metadata, updated_at: new Date().toISOString() })
      } else {
        await api.post('/items/gated_policy_rules', { node_id: nodeId, rule_type: ruleType, value, metadata })
      }
    },
    async deleteRule(ruleId: string): Promise<void> {
      await api.delete(`/items/gated_policy_rules/${ruleId}`)
    },

    // ── Collection tree ──────────────────────────────────────────────
    /** List all user-facing Directus collections (skip system + gated_ tables). */
    async listUserCollections(): Promise<Array<{ collection: string }>> {
      const r = await api.get('/collections')
      const all: Array<{ collection: string; meta?: { system?: boolean; hidden?: boolean } }> = r.data?.data ?? []
      return all.filter(c =>
        !c.collection.startsWith('directus_') &&
        !c.collection.startsWith('gated_') &&
        !c.meta?.system
      )
    },
    /** List all collection-level policy nodes that are children of the project node. */
    async listCollectionNodes(projectNodeId: string): Promise<PolicyNode[]> {
      const r = await api.get('/items/gated_policy_nodes', {
        params: { filter: { _and: [{ parent_id: { _eq: projectNodeId } }, { scope_type: { _eq: 'collection' } }] }, limit: 500 },
      })
      return r.data?.data ?? []
    },
    /** Ensure a collection-level policy node exists. Returns its id. */
    async ensureCollectionNode(projectNodeId: string, collectionName: string): Promise<string> {
      const existing = await api.get('/items/gated_policy_nodes', {
        params: { filter: { _and: [{ parent_id: { _eq: projectNodeId } }, { scope_type: { _eq: 'collection' } }, { scope_ref: { _eq: collectionName } }] }, limit: 1 },
      })
      const row = existing.data?.data?.[0] as PolicyNode | undefined
      if (row) return row.id
      const created = await api.post('/items/gated_policy_nodes', { scope_type: 'collection', scope_ref: collectionName, parent_id: projectNodeId, inherit: true })
      return created.data?.data?.id
    },

    // ── Item-level nodes ────────────────────────────────────────────
    /** List items in a Directus collection (returns id + display fields). */
    async listCollectionItems(collectionName: string, limit = 200): Promise<Array<Record<string, unknown>>> {
      const r = await api.get(`/items/${collectionName}`, { params: { limit, fields: ['*'] } })
      return r.data?.data ?? []
    },
    /** Get the primary key field name for a collection. */
    async getPrimaryKeyField(collectionName: string): Promise<string> {
      const r = await api.get(`/fields/${collectionName}`)
      const fields: Array<{ field: string; schema?: { is_primary_key?: boolean } }> = r.data?.data ?? []
      const pk = fields.find(f => f.schema?.is_primary_key)
      return pk?.field ?? 'id'
    },
    /** List item-level policy nodes under a collection node. */
    async listItemNodes(collectionNodeId: string): Promise<PolicyNode[]> {
      const r = await api.get('/items/gated_policy_nodes', {
        params: { filter: { _and: [{ parent_id: { _eq: collectionNodeId } }, { scope_type: { _eq: 'item' } }] }, limit: 500 },
      })
      return r.data?.data ?? []
    },
    /** Ensure an item-level policy node exists. Returns its id. */
    async ensureItemNode(collectionNodeId: string, itemId: string): Promise<string> {
      const existing = await api.get('/items/gated_policy_nodes', {
        params: { filter: { _and: [{ parent_id: { _eq: collectionNodeId } }, { scope_type: { _eq: 'item' } }, { scope_ref: { _eq: itemId } }] }, limit: 1 },
      })
      const row = existing.data?.data?.[0] as PolicyNode | undefined
      if (row) return row.id
      const created = await api.post('/items/gated_policy_nodes', { scope_type: 'item', scope_ref: itemId, parent_id: collectionNodeId, inherit: true })
      return created.data?.data?.id
    },

    // ── Crawler events ─────────────────────────────────────────────
    async listCrawlerEvents(limit = 100): Promise<CrawlerEvent[]> {
      const r = await api.get('/items/gated_crawler_events', { params: { sort: ['-observed_at'], limit } })
      return r.data?.data ?? []
    },
    async purgeCrawlerEvents(): Promise<number> {
      // Get all event IDs then bulk delete
      const r = await api.get('/items/gated_crawler_events', { params: { fields: ['id'], limit: -1 } })
      const ids = (r.data?.data ?? []).map((e: { id: string }) => e.id)
      if (ids.length > 0) {
        await api.delete('/items/gated_crawler_events', { data: ids })
      }
      return ids.length
    },
  }
}
