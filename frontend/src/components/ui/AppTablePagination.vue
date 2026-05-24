<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const page = defineModel<number>({ required: true })

const props = withDefaults(
  defineProps<{
    pages: number
    disabled?: boolean
    /** Сколько номеров страниц показывать в полоске (окно сдвигается вместе с текущей) */
    visiblePageButtons?: number
  }>(),
  {
    disabled: false,
    visiblePageButtons: 7,
  },
)

/** Узкий экран: меньше номеров в полоске — без налезания на соседние блоки. */
const MOBILE_PAGER_MQ = '(max-width: 640px)'
const MAX_VISIBLE_PAGES_MOBILE = 3

const isMobilePager = ref(false)
let mobilePagerMq: MediaQueryList | null = null
let mobilePagerListener: ((e: MediaQueryListEvent) => void) | null = null

onMounted(() => {
  mobilePagerMq = window.matchMedia(MOBILE_PAGER_MQ)
  isMobilePager.value = mobilePagerMq.matches
  mobilePagerListener = (e: MediaQueryListEvent) => {
    isMobilePager.value = e.matches
  }
  mobilePagerMq.addEventListener('change', mobilePagerListener)
})

onBeforeUnmount(() => {
  if (mobilePagerMq && mobilePagerListener) {
    mobilePagerMq.removeEventListener('change', mobilePagerListener)
  }
})

const paginationSize = computed(() => (isMobilePager.value ? 'small' : 'medium'))

const capVisibleButtons = computed(() =>
  isMobilePager.value
    ? Math.min(MAX_VISIBLE_PAGES_MOBILE, props.visiblePageButtons)
    : props.visiblePageButtons,
)

const numberStripSize = computed(() =>
  Math.min(capVisibleButtons.value, Math.max(1, props.pages)),
)

function goFirst() {
  page.value = 1
}
function goPrev() {
  page.value = Math.max(1, page.value - 1)
}
function goNext() {
  page.value = Math.min(props.pages, page.value + 1)
}
function goLast() {
  page.value = props.pages
}
</script>

<template>
  <div class="app-table-pagination">
    <VaButton
      preset="secondary"
      plain
      rounded
      icon="va-arrow-first"
      :size="paginationSize"
      :disabled="disabled || page <= 1"
      :aria-label="$t('common.paginationFirst')"
      @click="goFirst"
    />
    <VaButton
      preset="secondary"
      plain
      rounded
      icon="va-arrow-left"
      :size="paginationSize"
      :disabled="disabled || page <= 1"
      :aria-label="$t('common.paginationPrev')"
      @click="goPrev"
    />
    <VaPagination
      v-model="page"
      class="app-table-pagination__numbers"
      :pages="pages"
      :visible-pages="numberStripSize"
      :direction-links="false"
      :boundary-links="false"
      rounded
      gapped
      :size="paginationSize"
      :disabled="disabled"
      color="primary"
      :button-props="{ preset: 'secondary', plain: true, size: paginationSize }"
      :active-button-props="{ color: 'primary', plain: false, size: paginationSize }"
    />
    <VaButton
      preset="secondary"
      plain
      rounded
      icon="va-arrow-right"
      :size="paginationSize"
      :disabled="disabled || page >= pages"
      :aria-label="$t('common.paginationNext')"
      @click="goNext"
    />
    <VaButton
      preset="secondary"
      plain
      rounded
      icon="va-arrow-last"
      :size="paginationSize"
      :disabled="disabled || page >= pages"
      :aria-label="$t('common.paginationLast')"
      @click="goLast"
    />
  </div>
</template>

<style scoped>
.app-table-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.app-table-pagination__numbers {
  display: flex;
  align-items: center;
}

/* Без обводок; неактивные — насыщенный цвет текста/иконок */
.app-table-pagination :deep(.va-button) {
  border: none !important;
  box-shadow: none !important;
}

.app-table-pagination
  :deep(.va-button:not(.va-button--current):not(:disabled):not(.va-button--disabled)) {
  color: var(--va-primary) !important;
  --va-button-color: var(--va-primary);
  font-weight: 600;
}

.app-table-pagination
  :deep(
    .va-button:not(.va-button--current):not(:disabled):not(.va-button--disabled) .va-icon
  ) {
  color: var(--va-primary) !important;
}

.app-table-pagination
  :deep(.va-button:not(.va-button--current):not(:disabled):not(.va-button--disabled):hover) {
  color: var(--va-primary) !important;
  background-color: color-mix(
    in srgb,
    var(--va-primary) 14%,
    var(--va-background-secondary, var(--app-surface, #fff))
  ) !important;
}

.app-table-pagination :deep(.va-button:not(:disabled):focus-visible) {
  outline: 2px solid color-mix(in srgb, var(--va-primary) 45%, transparent);
  outline-offset: 1px;
}

.app-table-pagination :deep(.va-button--current:not(:disabled):hover) {
  filter: brightness(0.94);
}

.app-table-pagination :deep(.va-button:disabled:hover),
.app-table-pagination :deep(.va-button.va-button--disabled:hover) {
  background-color: transparent !important;
  box-shadow: none !important;
  filter: none;
}

@media (max-width: 640px) {
  .app-table-pagination {
    justify-content: flex-start;
    flex-wrap: nowrap;
    gap: 0.35rem;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow-x: auto;
    overflow-y: visible;
    -webkit-overflow-scrolling: touch;
    padding: 0.1rem 0;
    box-sizing: border-box;
  }

  .app-table-pagination__numbers {
    flex-shrink: 0;
  }
}
</style>
