<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  searchPlaceholder: string
  searchLabel: string
  createLabel: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'search'): void
  (e: 'create'): void
}>()

function onSearchChange(value: unknown) {
  emit('update:modelValue', typeof value === 'string' ? value : '')
}
</script>

<template>
  <div class="toolbar">
    <VaInput
      :model-value="props.modelValue"
      :placeholder="props.searchPlaceholder"
      class="toolbar__search"
      :disabled="props.disabled"
      @update:model-value="onSearchChange"
      @keyup.enter="emit('search')"
    />
    <VaButton :disabled="props.disabled" icon="search" @click="emit('search')">
      {{ props.searchLabel }}
    </VaButton>
    <VaButton color="primary" :disabled="props.disabled" icon="add" @click="emit('create')">
      {{ props.createLabel }}
    </VaButton>
    <slot />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
}

.toolbar__search {
  min-width: 16rem;
}
</style>
