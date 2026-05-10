<script setup lang="ts">
defineProps<{
  title: string
  subtitle?: string
  /** Для aria-связки с модалкой без заголовка VaModal */
  titleId?: string
}>()
</script>

<template>
  <section class="section-card">
    <header class="section-card__header">
      <h3 :id="titleId" class="section-card__title">{{ title }}</h3>
      <p v-if="subtitle" class="section-card__subtitle">{{ subtitle }}</p>
    </header>
    <div class="section-card__content">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.section-card {
  border: 1px solid var(--app-border);
  border-radius: var(--app-card-radius);
  padding: var(--app-modal-padding);
  background: color-mix(in srgb, var(--app-surface) 96%, var(--app-bg-end));
}

.section-card__header {
  margin-bottom: var(--app-section-gap);
}

.section-card__title {
  color: var(--app-text);
  font-size: 1rem;
  font-weight: 700;
}

.section-card__subtitle {
  margin-top: 0.35rem;
  color: var(--app-muted);
  font-size: 0.9rem;
}
</style>
