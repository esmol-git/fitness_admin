<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const { t } = useI18n()
const router = useRouter()

function goHome() {
  router.push({ name: 'home' })
}
</script>

<template>
  <div class="not-found-page">
    <VaCard class="not-found-card rounded-2xl" :gradient="false">
      <VaCardTitle class="not-found-title">
        <span class="not-found-code">{{ t('notFound.code') }}</span>
        {{ t('notFound.title') }}
      </VaCardTitle>
      <VaCardContent>
        <p class="not-found-desc">{{ t('notFound.description') }}</p>
        <VaButton class="not-found-action" size="large" block @click="goHome">
          {{ t('notFound.backHome') }}
        </VaButton>
      </VaCardContent>
    </VaCard>
  </div>
</template>

<style scoped>
.not-found-page {
  width: 100%;
  max-width: 460px;
  margin: 0 auto;
  padding: 1rem;
}

.not-found-card {
  background: var(--app-surface) !important;
  border: none !important;
  border-radius: 16px;
  box-shadow: var(--app-shadow-card);
}

.not-found-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 0.35rem 0.5rem;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-align: center;
  text-transform: uppercase;
  padding-bottom: 0.5rem;
}

.not-found-code {
  font-size: 1.6rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--va-primary);
}

.not-found-desc {
  margin: 0 0 1.25rem;
  text-align: center;
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--app-muted);
}

.not-found-action {
  font-weight: 600;
  letter-spacing: 0.02em;
}
</style>
