<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  hasActiveFilters?: boolean
  resetLabel?: string
}>()

const emit = defineEmits<{
  (e: 'reset'): void
}>()

const { t } = useI18n()
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
      {{ resetLabel ?? t('common.reset') }}
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
