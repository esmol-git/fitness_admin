<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppPageCard from '@/components/ui/AppPageCard.vue'

const { t } = useI18n()
</script>

<template>
  <AppPageCard :title="t('about.title')">
    <p class="about-lead">{{ t('about.lead') }}</p>
    <p class="about-stack">{{ t('about.stack') }}</p>
  </AppPageCard>
</template>

<style scoped>
.about-lead {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--app-text);
}

.about-stack {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--app-muted);
}
</style>
