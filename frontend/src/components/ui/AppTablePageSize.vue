<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TABLE_PAGE_SIZES } from '@/config/tablePagination'

const model = defineModel<number>({ required: true })

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    /** Допустимые значения page size (порядок = порядок в селекте) */
    sizes?: readonly number[]
  }>(),
  {
    disabled: false,
    sizes: () => [...TABLE_PAGE_SIZES],
  },
)

const emit = defineEmits<{
  (e: 'change'): void
}>()

const { t } = useI18n()

const options = computed(() => props.sizes.map((n) => ({ text: String(n), value: n })))

const allowed = computed(() => new Set(props.sizes))

function onSelect(value: unknown) {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n) || !allowed.value.has(n)) return
  if (model.value === n) return
  model.value = n
  emit('change')
}
</script>

<template>
  <div class="app-table-page-size">
    <span class="app-table-page-size__label">{{ t('common.rowsPerPage') }}</span>
    <div class="app-table-page-size__wrap">
      <VaSelect
        :model-value="model"
        :options="options"
        value-by="value"
        text-by="text"
        width="100%"
        :disabled="disabled"
        @update:model-value="onSelect"
      />
    </div>
  </div>
</template>

<style scoped>
.app-table-page-size {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.app-table-page-size__label {
  font-size: 0.9rem;
  color: var(--app-muted);
  white-space: nowrap;
}

/* VaSelect: scoped-класс на корне совпадает с .va-select — стили вешаем на обёртку */
.app-table-page-size__wrap {
  flex: 0 0 5.5rem;
  width: 5.5rem;
  max-width: 5.5rem;
  min-width: 0;
}

.app-table-page-size__wrap :deep(.va-select) {
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
}

.app-table-page-size__wrap :deep(.va-select__anchor) {
  min-width: 0 !important;
  width: 100% !important;
  max-width: 100% !important;
  padding-left: 0.45rem;
  padding-right: 0.35rem;
  gap: 0.35rem;
  font-size: 0.875rem;
  box-sizing: border-box;
}

.app-table-page-size__wrap :deep(.va-select__toggle-icon) {
  flex-shrink: 0;
  margin-left: 0;
  font-size: 1rem !important;
  opacity: 0.9;
}

.app-table-page-size__wrap :deep(.va-input-wrapper) {
  min-width: 0 !important;
  width: 100% !important;
}

.app-table-page-size__wrap :deep(.va-select-content) {
  min-width: 3.25ch !important;
  flex: 0 0 auto;
  overflow: visible;
  justify-content: flex-start;
  text-align: left;
}

@media (max-width: 640px) {
  .app-table-page-size {
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
    width: 100%;
    max-width: 100%;
  }

  .app-table-page-size__label {
    white-space: normal;
    font-size: 0.8125rem;
    line-height: 1.25;
  }

  .app-table-page-size__wrap {
    flex: none;
    width: 100%;
    max-width: 100%;
  }
}
</style>
