<template>
  <div>
    <h2>Crawler Log</h2>
    <p class="subtitle">
      Local AI crawler observations. Free tier: capped at 30 days / 5,000 events.
      <button class="g-btn-link" @click="load">refresh</button>
      <template v-if="events.length > 0">
        &middot;
        <button class="g-btn-link danger" @click="onPurge">purge all</button>
      </template>
    </p>

    <div v-if="atCap" class="g-cap-banner">
      You're at the free-tier cap. Upgrade to Pro for unlimited retention and webhooks.
      <a href="/admin/gated/upgrade" style="color: inherit; font-weight: 600;">See plans</a>
    </div>

    <div v-if="selectedEvent" class="g-panel" style="margin-bottom: 16px; border-color: var(--g-state-denied);">
      <div class="g-panel-header">
        <span class="eyebrow" style="color: var(--g-state-denied);">Violation detail</span>
        <button class="g-btn-link" @click="selectedEvent = null">close</button>
      </div>
      <div class="g-panel-body">
        <table class="detail-table">
          <tr><td class="detail-label">Agent</td><td>{{ selectedEvent.agent_name }}</td></tr>
          <tr><td class="detail-label">User-Agent</td><td class="mono small">{{ selectedEvent.user_agent }}</td></tr>
          <tr><td class="detail-label">Path</td><td class="mono">{{ selectedEvent.path }}</td></tr>
          <tr><td class="detail-label">Time</td><td>{{ new Date(selectedEvent.observed_at).toLocaleString() }}</td></tr>
          <tr><td class="detail-label">Reason</td><td style="color: var(--g-state-denied); font-weight: 600;">{{ selectedEvent.violation_reason || 'No reason recorded (predates compliance tracking)' }}</td></tr>
        </table>
        <div class="g-callout danger" style="margin-top: 12px;">
          <p v-if="selectedEvent.violation_reason?.includes('licensed')">
            <strong>Licensed content.</strong> This crawler accessed content that requires a license agreement before AI systems can use it. Consider setting up governed access to issue tokens to authorized agents.
          </p>
          <p v-else-if="selectedEvent.violation_reason?.includes('restricted')">
            <strong>Restricted content.</strong> This crawler accessed content that requires explicit authorization via a bearer token. Without a valid token, all access is denied.
          </p>
          <p v-else-if="selectedEvent.violation_reason?.includes('training denied')">
            <strong>Training denied.</strong> This crawler accessed content where AI training is explicitly denied. This is signaled via X-Robots-Tag headers and ai.txt.
          </p>
          <p v-else-if="selectedEvent.violation_reason?.includes('retrieval denied')">
            <strong>Retrieval denied.</strong> This crawler accessed content where retrieval is explicitly denied. Your robots.txt directs this crawler not to access this path.
          </p>
          <p v-else>
            This crawler accessed content that your policy restricts. Check the policy editor for rules applied to this path.
          </p>
        </div>
      </div>
    </div>

    <div v-if="events.length" class="g-panel">
      <table class="g-table">
        <thead>
          <tr><th>When</th><th>Agent</th><th>Method</th><th>Path</th><th>Compliance</th><th>User-Agent</th></tr>
        </thead>
        <tbody>
          <tr v-for="e in events" :key="e.id">
            <td class="mono small faint">{{ relative(e.observed_at) }}</td>
            <td><span class="g-pill g-pill-cyan">{{ e.agent_name }}</span></td>
            <td class="mono small">{{ e.method }}</td>
            <td class="mono small">{{ e.path }}</td>
            <td>
              <span v-if="e.compliance === 'violation'" class="g-pill g-pill-denied clickable" @click="selectedEvent = e">violation</span>
              <span v-else-if="e.compliance === 'allowed'" class="g-pill g-pill-healthy">allowed</span>
              <span v-else class="faint small">--</span>
            </td>
            <td class="mono small truncate faint">{{ e.user_agent }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="g-callout" style="margin-top: 16px;">No crawler events yet. AI crawlers will appear here when they visit your content.</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useGatedApi, type CrawlerEvent } from '../lib/api'

const gated = useGatedApi()
const events = ref<CrawlerEvent[]>([])
const selectedEvent = ref<CrawlerEvent | null>(null)
const atCap = computed(() => events.value.length >= 5000)

async function load() { events.value = await gated.listCrawlerEvents(500) }
async function onPurge() {
  if (!confirm('Delete all crawler log events? This cannot be undone.')) return
  const count = await gated.purgeCrawlerEvents(); selectedEvent.value = null; events.value = []
  alert(`Purged ${count} event(s).`)
}
function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime(); const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`; return `${Math.round(h / 24)}d ago`
}
onMounted(load)
</script>

<style scoped>
.detail-table { width: 100%; border-collapse: collapse; }
.detail-table td { padding: 4px 10px; border: none; vertical-align: top; font-size: 13px; }
.detail-label { color: var(--g-fg-faint); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; width: 100px; }
</style>
