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
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: visible;
}

.page-card:hover {
  box-shadow: var(--app-shadow-soft);
  transform: translateY(-1px);
}

.page-card__content {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--app-page-gap);
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}

.page-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  min-width: 0;
  overflow: visible;
}

.page-card__body {
  min-width: 0;
  width: 100%;
  max-width: 100%;
}

.page-card__title {
  font-size: 1.04rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--app-text);
}

.page-card__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-left: auto;
}

.page-card__actions :deep(.va-button) {
  min-height: var(--app-action-height);
}

.page-card__filters {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
  flex-wrap: wrap;
  width: 100%;
  min-width: 0;
  overflow: visible;
}
</style>
