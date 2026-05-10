<script setup lang="ts">
const props = defineProps<{
  title: string
  description?: string
  icon?: string
  actionLabel?: string
  actionIcon?: string
}>()

const emit = defineEmits<{
  (e: 'action'): void
}>()
</script>

<template>
  <div class="empty-state">
    <div class="empty-state__icon-wrap">
      <VaIcon :name="icon ?? 'inbox'" size="24px" class="empty-state__icon" />
    </div>
    <div class="empty-state__title">{{ title }}</div>
    <div v-if="description" class="empty-state__desc">{{ description }}</div>
    <slot name="action">
      <VaButton
        v-if="props.actionLabel"
        class="empty-state__action"
        :icon="props.actionIcon ?? 'add'"
        @click="emit('action')"
      >
        {{ props.actionLabel }}
      </VaButton>
    </slot>
    <slot />
  </div>
</template>

<style scoped>
.empty-state {
  border: 1px dashed var(--app-border);
  border-radius: 14px;
  padding: 2.2rem 1.1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  color: var(--app-muted);
  background: color-mix(in srgb, var(--app-surface) 97%, var(--app-bg-end));
}

.empty-state__icon-wrap {
  width: 3.15rem;
  height: 3.15rem;
  margin: 0 auto;
  border-radius: 0.9rem;
  position: relative;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--app-accent) 14%, white);
}

.empty-state__icon {
  position: absolute;
  inset: 0;
  margin: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  line-height: 1;
  opacity: 0.95;
  color: var(--app-accent-strong);
}

.empty-state__icon :deep(i),
.empty-state__icon :deep(.material-icons) {
  display: block;
  line-height: 1;
}

.empty-state__title {
  margin-top: 0.95rem;
  color: var(--app-text);
  font-weight: 700;
  font-size: 1.1rem;
}

.empty-state__desc {
  margin: 0.45rem auto 0;
  max-width: 34rem;
  font-size: 0.96rem;
  line-height: 1.45;
}

.empty-state__action {
  margin-top: 1rem;
  font-weight: 600;
}
</style>
