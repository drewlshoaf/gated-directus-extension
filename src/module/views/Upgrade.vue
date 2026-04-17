<template>
  <div>
    <h2>Plans</h2>
    <p class="subtitle">
      Free is fully functional locally — forever, no payment required.
      Paid tiers add hosted observability, audit, webhooks, and governed access enforcement.
    </p>

    <div class="tier-grid">
      <div v-for="plan in plans" :key="plan.name" class="g-panel tier" :class="{ current: plan.name === 'Free' }">
        <div class="g-panel-body">
          <span class="eyebrow">{{ plan.name }}</span>
          <div class="price">{{ plan.price }}</div>
          <ul>
            <li v-for="f in plan.features" :key="f">{{ f }}</li>
          </ul>
          <button
            v-if="plan.cta"
            class="g-btn"
            :class="plan.name === 'Free' ? '' : 'g-btn-primary'"
            :disabled="plan.name === 'Free'"
            style="width: 100%; margin-top: auto;"
          >{{ plan.cta }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const plans = [
  { name: 'Free', price: '$0', cta: 'Current plan', features: ['Local policy management', 'Artifact generation + serving', 'Local crawler log (30d / 5k cap)', 'No teammate cap'] },
  { name: 'Pro', price: '$99/mo', cta: 'Upgrade', features: ['Hosted dashboard', 'Long-retention audit log', 'Webhooks', 'Programmatic API', '1 connector / 5 install tokens'] },
  { name: 'Business', price: '$349/mo', cta: 'Upgrade', features: ['Multi-project', 'Multi-CMS connectors', 'Alerts (email / Slack / PagerDuty)', '~5 connectors / unlimited tokens'] },
  { name: 'Enterprise', price: 'Custom', cta: 'Contact sales', features: ['Enterprise SSO (WorkOS)', 'Phase 3: named agent identities', 'Phase 3: token-based enforcement', 'Phase 4: licensing + metering'] },
]
</script>

<style scoped>
.tier-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}
.tier { display: flex; flex-direction: column; }
.tier.current { border-color: var(--g-accent-cyan); box-shadow: 0 0 30px -10px rgba(34, 211, 238, 0.2); }
.price { font-size: 28px; font-weight: 600; margin: 10px 0 12px; color: var(--g-fg-base); }
ul { list-style: none; padding: 0; margin: 0 0 16px; flex: 1; }
li { padding: 4px 0; font-size: 13px; color: var(--g-fg-muted); }
li::before { content: '\2713  '; color: var(--g-state-healthy); font-weight: 600; }
</style>
