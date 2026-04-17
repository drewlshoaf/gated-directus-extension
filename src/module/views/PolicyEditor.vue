<template>
  <div>
    <h2>Policy</h2>
    <p class="subtitle">
      Set AI access policy at the project, collection, or item level.
      Closest node wins. One rule per type per node.
    </p>

    <div v-if="loading" class="muted">Loading...</div>
    <div v-else-if="!projectNode" class="g-callout warn">
      No project policy node exists. The bootstrap hook should have seeded one — check
      <code>docker compose logs directus | grep gated:</code>.
    </div>

    <div v-else class="layout">
      <nav class="g-tree">
        <div
          class="g-tree-item"
          :class="{ active: selectedNodeId === projectNode.id }"
          @click="selectProjectNode()"
        >
          Project root
        </div>
        <div class="g-tree-section">
          <div class="g-tree-label">Collections</div>
          <template v-for="c in collections" :key="c.name">
            <div
              class="g-tree-item g-tree-indent"
              :class="{ active: selectedNodeId === c.nodeId && selectedScope === 'collection' }"
              @click="selectCollection(c)"
            >
              {{ c.name }}
              <span v-if="c.hasOverrides" class="g-badge-override">override</span>
            </div>
            <template v-if="expandedCollection === c.name && items.length > 0">
              <div
                v-for="item in items"
                :key="item.id"
                class="g-tree-item g-tree-indent-2"
                :class="{ active: selectedNodeId === item.nodeId && selectedScope === 'item' }"
                @click="selectItem(c, item)"
              >
                <span class="g-item-label">{{ item.label }}</span>
                <span v-if="item.hasOverrides" class="g-badge-override">override</span>
              </div>
            </template>
          </template>
          <div v-if="collections.length === 0" class="muted small g-tree-indent" style="padding: 8px 10px 8px 24px;">
            No user collections found.
          </div>
        </div>
      </nav>

      <div class="editor">
        <div class="g-panel">
          <div class="g-panel-header">
            <div>
              <span class="eyebrow">{{ selectedScope }}</span>
              <h3 style="margin-top:4px">{{ selectedLabel }}
                <span class="mono faint small" style="font-weight:400"> {{ selectedNodeId?.slice(0, 8) }}...</span>
              </h3>
            </div>
          </div>
          <div class="g-panel-body">
            <p v-if="selectedScope !== 'project'" class="muted small" style="margin-bottom:12px;">
              Leave a rule as (none) to inherit from the {{ selectedScope === 'item' ? 'collection or project' : 'project' }} default.
            </p>
            <table class="g-table">
              <thead>
                <tr><th>Rule type</th><th>Value</th><th>Source</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="t in RULE_TYPES" :key="t.key">
                  <td class="mono">{{ t.key }}</td>
                  <td>
                    <select class="g-select" v-model="draft[t.key]">
                      <option v-for="v in t.values" :key="v" :value="v">{{ v }}</option>
                      <option value="">(none)</option>
                    </select>
                  </td>
                  <td><span class="g-pill g-pill-muted">{{ ruleSource(t.key) }}</span></td>
                  <td>
                    <button v-if="rulesByType[t.key]" class="g-btn-danger g-btn" @click="onDelete(t.key)">remove</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="g-actions">
              <button class="g-btn g-btn-primary" :disabled="saving" @click="onSaveAll">
                {{ saving ? 'Saving...' : 'Save all changes' }}
              </button>
              <span v-if="lastSavedAt" class="muted small">saved {{ lastSavedAt }}</span>
            </div>
          </div>
        </div>

        <div class="g-panel">
          <div class="g-panel-header">
            <span class="eyebrow">Effective policy preview</span>
          </div>
          <div class="g-panel-body">
            <p class="muted small" style="margin-bottom: 8px;">
              Resolved policy after inheritance. Closest node wins.
            </p>
            <pre class="g-code">{{ JSON.stringify(effective, null, 2) }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useGatedApi, type PolicyNode, type PolicyRule } from '../lib/api'

const RULE_TYPES = [
  { key: 'allow_retrieval',     values: ['allow', 'deny'] },
  { key: 'allow_training',      values: ['allow', 'deny'] },
  { key: 'allow_summarization', values: ['allow', 'deny'] },
  { key: 'allow_search_display',values: ['allow', 'deny'] },
  { key: 'require_attribution', values: ['require', 'none'] },
  { key: 'access_class',        values: ['public', 'licensed', 'restricted'] },
] as const

interface CollectionEntry { name: string; nodeId: string | null; hasOverrides: boolean }
interface ItemEntry { id: string; label: string; nodeId: string | null; hasOverrides: boolean }

const gated = useGatedApi()
const loading = ref(true)
const saving = ref(false)
const lastSavedAt = ref<string | null>(null)
const projectNode = ref<PolicyNode | null>(null)
const collections = ref<CollectionEntry[]>([])
const expandedCollection = ref<string | null>(null)
const items = ref<ItemEntry[]>([])
const selectedNodeId = ref<string | null>(null)
const selectedScope = ref<'project' | 'collection' | 'item'>('project')
const selectedCollectionName = ref<string | null>(null)
const selectedItemLabel = ref<string | null>(null)
const rules = ref<PolicyRule[]>([])
const projectRules = ref<PolicyRule[]>([])
const collectionRules = ref<PolicyRule[]>([])
const draft = ref<Record<string, string>>({})

const selectedLabel = computed(() => {
  if (selectedScope.value === 'project') return 'Project root'
  if (selectedScope.value === 'item') return `${selectedCollectionName.value} / ${selectedItemLabel.value}`
  return selectedCollectionName.value ?? 'collection'
})

const rulesByType = computed(() => { const m: Record<string, PolicyRule> = {}; for (const r of rules.value) m[r.rule_type] = r; return m })
const projectRulesByType = computed(() => { const m: Record<string, PolicyRule> = {}; for (const r of projectRules.value) m[r.rule_type] = r; return m })
const collectionRulesByType = computed(() => { const m: Record<string, PolicyRule> = {}; for (const r of collectionRules.value) m[r.rule_type] = r; return m })

function ruleSource(ruleType: string): string {
  if (rulesByType.value[ruleType]) {
    if (selectedScope.value === 'project') return 'project'
    if (selectedScope.value === 'collection') return 'collection'
    return 'item'
  }
  if (selectedScope.value === 'item' && collectionRulesByType.value[ruleType]) return 'inherited: collection'
  if (selectedScope.value !== 'project' && projectRulesByType.value[ruleType]) return 'inherited: project'
  return 'default'
}

const effective = computed(() => {
  const out: Record<string, { value: string; source: string }> = {}
  for (const t of RULE_TYPES) { const pv = selectedScope.value === 'project' ? draft.value[t.key] : projectRulesByType.value[t.key]?.value; if (pv) out[t.key] = { value: pv, source: 'project' } }
  if (selectedScope.value === 'collection') { for (const t of RULE_TYPES) { const v = draft.value[t.key]; if (v) out[t.key] = { value: v, source: 'collection' } } }
  else if (selectedScope.value === 'item') { for (const t of RULE_TYPES) { const cv = collectionRulesByType.value[t.key]?.value; if (cv) out[t.key] = { value: cv, source: 'collection' } }; for (const t of RULE_TYPES) { const v = draft.value[t.key]; if (v) out[t.key] = { value: v, source: 'item' } } }
  return { scope_type: selectedScope.value, scope_ref: selectedItemLabel.value ?? selectedCollectionName.value, rules: out }
})

async function load() {
  loading.value = true
  try {
    projectNode.value = await gated.getProjectNode()
    if (!projectNode.value) return
    projectRules.value = await gated.listRules(projectNode.value.id)
    const [userCollections, existingNodes] = await Promise.all([gated.listUserCollections(), gated.listCollectionNodes(projectNode.value.id)])
    const nodeMap = new Map(existingNodes.map(n => [n.scope_ref, n]))
    collections.value = userCollections.map(c => ({ name: c.collection, nodeId: nodeMap.get(c.collection)?.id ?? null, hasOverrides: false }))
    for (const c of collections.value) { if (c.nodeId) { const cRules = await gated.listRules(c.nodeId); c.hasOverrides = cRules.length > 0 } }
    selectProjectNode()
  } finally { loading.value = false }
}

function seedDraft() { const next: Record<string, string> = {}; for (const t of RULE_TYPES) next[t.key] = rulesByType.value[t.key]?.value ?? ''; draft.value = next }

async function selectProjectNode() {
  if (!projectNode.value) return
  selectedNodeId.value = projectNode.value.id; selectedScope.value = 'project'; selectedCollectionName.value = null; selectedItemLabel.value = null
  expandedCollection.value = null; items.value = []; collectionRules.value = []
  rules.value = await gated.listRules(projectNode.value.id); seedDraft()
}

async function selectCollection(c: CollectionEntry) {
  if (!projectNode.value) return
  if (!c.nodeId) c.nodeId = await gated.ensureCollectionNode(projectNode.value.id, c.name)
  selectedNodeId.value = c.nodeId; selectedScope.value = 'collection'; selectedCollectionName.value = c.name; selectedItemLabel.value = null; collectionRules.value = []
  rules.value = await gated.listRules(c.nodeId); seedDraft()
  expandedCollection.value = c.name; await loadItems(c)
}

async function loadItems(c: CollectionEntry) {
  if (!c.nodeId) return
  try {
    const [rawItems, pkField, existingItemNodes] = await Promise.all([gated.listCollectionItems(c.name), gated.getPrimaryKeyField(c.name), gated.listItemNodes(c.nodeId)])
    const itemNodeMap = new Map(existingItemNodes.map(n => [n.scope_ref, n]))
    items.value = rawItems.map(item => { const pk = String(item[pkField] ?? ''); const node = itemNodeMap.get(pk); const label = String(item['title'] ?? item['name'] ?? item['label'] ?? item['subject'] ?? item['slug'] ?? pk); return { id: pk, label, nodeId: node?.id ?? null, hasOverrides: false } })
    for (const it of items.value) { if (it.nodeId) { const iRules = await gated.listRules(it.nodeId); it.hasOverrides = iRules.length > 0 } }
  } catch { items.value = [] }
}

async function selectItem(c: CollectionEntry, item: ItemEntry) {
  if (!c.nodeId) return
  if (!item.nodeId) item.nodeId = await gated.ensureItemNode(c.nodeId, item.id)
  selectedNodeId.value = item.nodeId; selectedScope.value = 'item'; selectedCollectionName.value = c.name; selectedItemLabel.value = item.label
  collectionRules.value = await gated.listRules(c.nodeId); rules.value = await gated.listRules(item.nodeId); seedDraft()
}

async function onSaveAll() {
  if (!selectedNodeId.value) return; saving.value = true
  try {
    for (const t of RULE_TYPES) { const desired = draft.value[t.key]; const existing = rulesByType.value[t.key]; if (desired && desired !== existing?.value) await gated.upsertRule(selectedNodeId.value, t.key, desired); else if (!desired && existing) await gated.deleteRule(existing.id) }
    rules.value = await gated.listRules(selectedNodeId.value)
    if (selectedScope.value === 'project' && projectNode.value) projectRules.value = await gated.listRules(projectNode.value.id)
    if (selectedScope.value === 'collection' && selectedCollectionName.value) { const e = collections.value.find(c => c.name === selectedCollectionName.value); if (e) e.hasOverrides = rules.value.length > 0 }
    if (selectedScope.value === 'item') { const e = items.value.find(i => i.nodeId === selectedNodeId.value); if (e) e.hasOverrides = rules.value.length > 0 }
    lastSavedAt.value = new Date().toLocaleTimeString()
  } finally { saving.value = false }
}

async function onDelete(ruleType: string) {
  const r = rulesByType.value[ruleType]; if (!r || !selectedNodeId.value) return
  await gated.deleteRule(r.id); rules.value = await gated.listRules(selectedNodeId.value); draft.value = { ...draft.value, [ruleType]: '' }
  if (selectedScope.value === 'collection' && selectedCollectionName.value) { const e = collections.value.find(c => c.name === selectedCollectionName.value); if (e) e.hasOverrides = rules.value.length > 0 }
  if (selectedScope.value === 'item') { const e = items.value.find(i => i.nodeId === selectedNodeId.value); if (e) e.hasOverrides = rules.value.length > 0 }
}

onMounted(load)
</script>

<style scoped>
.layout { display: grid; grid-template-columns: 240px 1fr; gap: 20px; }
.g-tree { max-height: 70vh; overflow-y: auto; }
.editor { display: flex; flex-direction: column; gap: 16px; }
</style>
