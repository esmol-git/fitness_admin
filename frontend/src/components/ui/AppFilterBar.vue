<script setup lang="ts">
defineProps<{
  hasActiveFilters?: boolean
  resetLabel?: string
}>()

const emit = defineEmits<{
  (e: 'reset'): void
}>()
</script>

<template>
  <div class="filter-bar">
    <slot />
    <VaButton
      preset="secondary"
      size="small"
      :disabled="!hasActiveFilters"
      icon="restart_alt"
      @click="emit('reset')"
    >
      {{ resetLabel ?? 'Reset' }}
    </VaButton>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  width: 100%;
  min-width: 0;
}
</style>
