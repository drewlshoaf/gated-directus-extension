<template>
  <private-view title="Gated">
    <div class="gated-module g-ambient">
      <nav class="tabs">
        <router-link to="/gated/policy">Policy</router-link>
        <router-link to="/gated/crawlers">Crawler log</router-link>
        <router-link to="/gated/activation">Activation</router-link>
        <router-link to="/gated/settings">Settings</router-link>
        <router-link to="/gated/upgrade">Plans</router-link>
      </nav>
      <section class="tab-content">
        <router-view />
      </section>
    </div>
  </private-view>
</template>

<style>
@import '../module/styles/gated-theme.css';
</style>

<style scoped>
.tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--g-border-subtle);
  padding-bottom: 0;
  margin-bottom: 24px;
}
.tabs a {
  color: var(--g-fg-faint);
  text-decoration: none;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}
.tabs a:hover {
  color: var(--g-fg-base);
}
.tabs a.router-link-active {
  color: var(--g-accent-cyan);
  border-bottom-color: var(--g-accent-cyan);
}
.tab-content {
  position: relative;
  z-index: 1;
}
</style>
