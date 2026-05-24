<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TableExportFormat } from '@/utils/tableExport'

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    loading?: boolean
  }>(),
  { disabled: false, loading: false },
)

const emit = defineEmits<{
  (e: 'export', format: TableExportFormat): void
}>()

const { t } = useI18n()
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

onClickOutside(rootRef, () => {
  open.value = false
})

function toggleOpen() {
  if (props.disabled || props.loading) return
  open.value = !open.value
}

function pick(format: TableExportFormat) {
  open.value = false
  emit('export', format)
}
</script>

<template>
  <div ref="rootRef" class="app-export-menu">
    <VaButton
      preset="secondary"
      class="app-export-menu__trigger"
      :disabled="disabled"
      :loading="loading"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="menu"
      @click="toggleOpen"
    >
      <VaIcon name="download" class="app-export-menu__trigger-icon" size="18px" />
      <span>{{ t('common.export') }}</span>
      <VaIcon
        name="expand_more"
        class="app-export-menu__chevron"
        :class="{ 'app-export-menu__chevron--open': open }"
        size="18px"
      />
    </VaButton>

    <Transition name="app-export-menu-fade">
      <div v-if="open" class="app-export-menu__panel" role="menu" @click.stop>
        <p class="app-export-menu__caption">{{ t('common.exportChooseFormat') }}</p>
        <ul class="app-export-menu__list">
          <li role="none">
            <button type="button" role="menuitem" class="app-export-menu__item" @click="pick('csv')">
              <VaIcon name="table_chart" size="18px" aria-hidden="true" />
              <span>{{ t('common.exportCsv') }}</span>
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" class="app-export-menu__item" @click="pick('xlsx')">
              <VaIcon name="grid_on" size="18px" aria-hidden="true" />
              <span>{{ t('common.exportExcel') }}</span>
            </button>
          </li>
        </ul>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.app-export-menu {
  position: relative;
  display: inline-flex;
  vertical-align: middle;
}

.app-export-menu__trigger :deep(.va-button__content) {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.app-export-menu__trigger-icon {
  opacity: 0.88;
}

.app-export-menu__chevron {
  margin-left: 0.05rem;
  opacity: 0.72;
  transition: transform 0.18s ease;
}

.app-export-menu__chevron--open {
  transform: rotate(180deg);
}

.app-export-menu__panel {
  position: absolute;
  top: calc(100% + 0.4rem);
  right: 0;
  z-index: 120;
  min-width: 11.5rem;
  padding: 0.45rem;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
  background: var(--app-surface);
  box-shadow: var(--app-shadow-soft);
}

.app-export-menu__caption {
  margin: 0 0.35rem 0.4rem;
  padding: 0 0.35rem;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--app-muted);
}

.app-export-menu__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.app-export-menu__item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.55rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--app-text);
  transition: background-color 0.15s ease;
}

.app-export-menu__item:hover {
  background: color-mix(in srgb, var(--app-accent) 10%, var(--app-surface));
}

.app-export-menu__item:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--app-accent) 55%, transparent);
  outline-offset: 1px;
}

.app-export-menu-fade-enter-active,
.app-export-menu-fade-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.app-export-menu-fade-enter-from,
.app-export-menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
