<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <VaCard class="page-card rounded-2xl">
    <VaCardContent class="page-card__content">
      <div class="page-card__header">
        <div class="page-card__title"><slot name="title">{{ title }}</slot></div>
        <div v-if="$slots.actions" class="page-card__actions"><slot name="actions" /></div>
      </div>
      <div v-if="$slots.filters" class="page-card__filters">
        <slot name="filters" />
      </div>
      <div class="page-card__body">
        <slot />
      </div>
    </VaCardContent>
  </VaCard>
</template>

<style scoped>
.page-card {
  background: var(--app-surface) !important;
  border: 1px solid color-mix(in srgb, var(--app-accent) 14%, var(--app-border)) !important;
  border-radius: var(--app-card-radius);
  box-shadow: var(--app-shadow-card);
  transition:
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.page-card:hover {
  box-shadow: var(--app-shadow-soft);
  transform: translateY(-1px);
}

.page-card__content {
  display: grid;
  gap: var(--app-page-gap);
}

.page-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.page-card__title {
  font-size: 1.04rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--app-text);
}

.page-card__actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.page-card__actions :deep(.va-button) {
  min-height: var(--app-action-height);
}

.page-card__filters {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
</style>
