<template>
  <div>
    <h2>Settings</h2>
    <p class="subtitle">Extension configuration and artifact validation.</p>

    <div class="settings-grid">
      <div class="g-panel">
        <div class="g-panel-header"><span class="eyebrow">Mode</span></div>
        <div class="g-panel-body">
          <p>Currently running in <span class="g-pill" :class="mode === 'connected' ? 'g-pill-cyan' : 'g-pill-muted'">{{ mode }}</span> mode.</p>
          <p class="muted small" style="margin-top:8px;">
            Free mode stores everything locally. Connected mode syncs with the hosted control plane.
          </p>
        </div>
      </div>

      <div class="g-panel">
        <div class="g-panel-header"><span class="eyebrow">Connected mode</span></div>
        <div class="g-panel-body">
          <label class="field-label">GATED_API_KEY</label>
          <input class="g-input" v-model="apiKey" type="password" placeholder="gtd_..." />
          <label class="field-label" style="margin-top:8px;">ORG ID</label>
          <input class="g-input" v-model="orgId" type="text" placeholder="uuid from dashboard Settings" />
          <p class="muted small" style="margin-bottom:12px;">
            Find your Org ID in the dashboard at Settings &gt; Account. Crawler events sync to this org.
          </p>
          <div class="g-actions" style="margin-top:0">
            <button class="g-btn g-btn-primary" @click="onSaveConnected">Save</button>
            <span v-if="saved" class="muted small">Saved.</span>
          </div>
        </div>
      </div>

      <div class="g-panel">
        <div class="g-panel-header"><span class="eyebrow">Identity</span></div>
        <div class="g-panel-body">
          <p class="mono small muted">extension_instance_id: {{ instanceId || '(not generated)' }}</p>
          <p class="mono small muted">activation_token: {{ token ? maskedToken : '(not activated)' }}</p>
        </div>
      </div>
    </div>

    <div class="g-panel" style="margin-top: 20px;">
      <div class="g-panel-header">
        <span class="eyebrow">Validation</span>
        <button class="g-btn" :disabled="validating" @click="runValidation">
          {{ validating ? 'Checking...' : 'Run validation' }}
        </button>
      </div>
      <div class="g-panel-body" v-if="validationResults.length > 0">
        <div class="validation-list">
          <div v-for="(r, i) in validationResults" :key="i" class="g-validation-item" :class="r.status">
            <span class="g-status-icon">{{ r.status === 'pass' ? '\u2713' : r.status === 'warn' ? '!' : '\u2717' }}</span>
            <div>
              <strong style="font-size:13px;">{{ r.label }}</strong>
              <p class="small muted" style="margin:2px 0 0;">{{ r.message }}</p>
              <p v-if="r.fix" class="small faint" style="margin:2px 0 0;">Fix: {{ r.fix }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useGatedApi } from '../lib/api'
import { useApi } from '@directus/extensions-sdk'

const gated = useGatedApi()
const api = useApi()
const apiKey = ref('')
const orgId = ref('')
const instanceId = ref('')
const token = ref('')
const saved = ref(false)
const validating = ref(false)

interface ValidationResult { label: string; status: 'pass' | 'warn' | 'fail'; message: string; fix?: string }
const validationResults = ref<ValidationResult[]>([])

const mode = computed(() => apiKey.value && orgId.value ? 'connected' : 'free')
const maskedToken = computed(() => token.value ? `${token.value.slice(0, 8)}...${token.value.slice(-4)}` : '')

onMounted(async () => {
  apiKey.value = (await gated.getSetting('gated_api_key')) ?? ''
  orgId.value = (await gated.getSetting('gated_org_id')) ?? ''
  instanceId.value = (await gated.getSetting('extension_instance_id')) ?? ''
  token.value = (await gated.getSetting('activation_token')) ?? ''
})

async function onSaveConnected() {
  await gated.setSetting('gated_api_key', apiKey.value)
  await gated.setSetting('gated_org_id', orgId.value)
  saved.value = true; setTimeout(() => (saved.value = false), 2000)
}

async function checkEndpoint(path: string, label: string): Promise<ValidationResult> {
  try {
    const r = await api.get(path, { validateStatus: () => true })
    if (r.status === 404) return { label, status: 'fail', message: `${path} returned 404.`, fix: 'Restart Directus to load extension endpoints.' }
    if (r.status !== 200) return { label, status: 'fail', message: `${path} returned HTTP ${r.status}.`, fix: 'Check Directus logs.' }
    const body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data)
    if (!body || body.length < 10) return { label, status: 'warn', message: `${path} returned unusually short response.`, fix: 'Check that policy rules are configured.' }
    return { label, status: 'pass', message: `${path} is reachable (${body.length} bytes).` }
  } catch (err) { return { label, status: 'fail', message: `${path} failed: ${err}`, fix: 'Ensure extension is installed and Directus restarted.' } }
}

async function runValidation() {
  validating.value = true; validationResults.value = []; const results: ValidationResult[] = []
  const projectNode = await gated.getProjectNode()
  if (!projectNode) { results.push({ label: 'Project node', status: 'fail', message: 'No project policy node found.', fix: 'Restart Directus.' }) }
  else {
    results.push({ label: 'Project node', status: 'pass', message: `Exists (${projectNode.id.slice(0, 8)}...).` })
    const rules = await gated.listRules(projectNode.id)
    results.push(rules.length === 0
      ? { label: 'Project policy', status: 'warn', message: 'No rules set. Default permissive policy in effect.', fix: 'Go to Policy tab.' }
      : { label: 'Project policy', status: 'pass', message: `${rules.length} rule(s) configured.` })
  }
  const [robots, aiTxt, wellKnown] = await Promise.all([checkEndpoint('/robots/', 'robots.txt'), checkEndpoint('/ai-txt/', 'ai.txt'), checkEndpoint('/well-known/ai', '.well-known/ai')])
  results.push(robots, aiTxt, wellKnown)
  if (robots.status === 'pass') results.push({ label: 'robots.txt path', status: 'pass', message: 'Gated serves policy at /robots/. Your reverse proxy rewrites /robots.txt to this endpoint.' })
  try {
    const collections = await gated.listUserCollections()
    const collectionNodes = projectNode ? await gated.listCollectionNodes(projectNode.id) : []
    const coveredNames = new Set(collectionNodes.map(n => n.scope_ref))
    const uncovered = collections.filter(c => !coveredNames.has(c.collection))
    results.push(uncovered.length === 0 && collections.length > 0
      ? { label: 'Collection coverage', status: 'pass', message: `All ${collections.length} collection(s) have policy nodes.` }
      : { label: 'Collection coverage', status: 'warn', message: `${uncovered.length} collection(s) without explicit policy.`, fix: 'Click each in Policy to create nodes.' })
  } catch { /* skip */ }
  results.push(!token.value
    ? { label: 'Activation', status: 'warn', message: 'Not activated.', fix: 'Go to Activation tab.' }
    : { label: 'Activation', status: 'pass', message: 'Account activated.' })
  validationResults.value = results; validating.value = false
}
</script>

<style scoped>
.settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.field-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--g-fg-faint); margin-bottom: 6px; }
.g-input { width: 100%; margin-bottom: 12px; }
.validation-list { display: flex; flex-direction: column; gap: 8px; }
</style>
