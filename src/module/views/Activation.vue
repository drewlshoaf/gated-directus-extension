<template>
  <div>
    <h2>Activation</h2>
    <p class="subtitle">
      Email verification gives you a long-lived activation token, used by the extension to
      check status and unlock paid features.
    </p>

    <div v-if="step === 'idle' || step === 'requesting'" class="g-panel" style="max-width: 480px;">
      <div class="g-panel-header"><span class="eyebrow">Verify email</span></div>
      <div class="g-panel-body">
        <label class="field-label">Email</label>
        <input class="g-input" v-model="email" type="email" placeholder="you@example.com" />
        <button class="g-btn g-btn-primary" :disabled="step === 'requesting' || !email" @click="onRequest">
          {{ step === 'requesting' ? 'Sending...' : 'Send verification code' }}
        </button>
      </div>
    </div>

    <div v-if="step === 'awaiting_code' || step === 'verifying'" class="g-panel" style="max-width: 480px;">
      <div class="g-panel-header"><span class="eyebrow">Enter code</span></div>
      <div class="g-panel-body">
        <p class="muted small" style="margin-bottom: 12px;">Code sent to <strong style="color:var(--g-fg-base)">{{ email }}</strong>. Check your inbox (or in dev, the api container logs).</p>
        <label class="field-label">6-digit code</label>
        <input class="g-input" v-model="code" maxlength="6" pattern="\d{6}" style="max-width:180px;" />
        <div class="g-actions">
          <button class="g-btn g-btn-primary" :disabled="step === 'verifying' || code.length !== 6" @click="onVerify">
            {{ step === 'verifying' ? 'Verifying...' : 'Verify' }}
          </button>
          <button class="g-btn" @click="onResend">Resend code</button>
        </div>
      </div>
    </div>

    <div v-if="step === 'activated'" class="g-callout success" style="max-width: 480px;">
      <p><strong>Activated</strong> as <strong>{{ email }}</strong> &mdash; tier <span class="g-pill g-pill-cyan">{{ tier }}</span></p>
      <p class="mono small muted" style="margin-top:6px;">extension_instance_id: {{ instId }}</p>
    </div>

    <div v-if="error" class="g-callout danger" style="max-width: 480px; margin-top: 12px;">
      {{ error }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useGatedApi } from '../lib/api'

const API_BASE = (window as any).GATED_API_BASE || 'http://localhost:3000'
const gated = useGatedApi()
const email = ref('')
const code = ref('')
const step = ref<'idle' | 'requesting' | 'awaiting_code' | 'verifying' | 'activated'>('idle')
const error = ref<string | null>(null)
const tier = ref('free')
const instId = ref('')

async function onRequest() {
  error.value = null; step.value = 'requesting'
  try {
    const r = await fetch(`${API_BASE}/activate/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.value }), mode: 'cors' })
    if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => '')}`)
    step.value = 'awaiting_code'
  } catch (e) { error.value = String(e); step.value = 'idle' }
}

async function onVerify() {
  error.value = null; step.value = 'verifying'
  try {
    let id = await gated.getSetting('extension_instance_id')
    if (!id) { id = 'inst_' + Math.random().toString(16).slice(2).padEnd(24, '0').slice(0, 24); await gated.setSetting('extension_instance_id', id) }
    instId.value = id
    const r = await fetch(`${API_BASE}/activate/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.value, code: code.value, extension_instance_id: id }) })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    const body = await r.json()
    await gated.setSetting('activation_token', body.activation_token)
    await gated.setSetting('activation_email', email.value)
    await gated.setSetting('activation_tier', body.tier)
    await gated.setSetting('activation_last_ok_at', new Date().toISOString())
    tier.value = body.tier; step.value = 'activated'
  } catch (e) { error.value = String(e); step.value = 'awaiting_code' }
}

async function onResend() {
  await fetch(`${API_BASE}/activate/resend`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.value }) })
}

onMounted(async () => {
  instId.value = (await gated.getSetting('extension_instance_id')) ?? ''
  const tok = await gated.getSetting('activation_token')
  if (tok) {
    step.value = 'activated'
    email.value = (await gated.getSetting('activation_email')) ?? ''
    tier.value = (await gated.getSetting('activation_tier')) ?? 'free'
  }
})
</script>

<style scoped>
.field-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--g-fg-faint); margin-bottom: 6px; }
.g-input { width: 100%; margin-bottom: 12px; }
</style>
