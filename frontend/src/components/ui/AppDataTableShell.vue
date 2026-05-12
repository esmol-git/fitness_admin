<script setup lang="ts">
import AppToolbarLoadingDot from '@/components/ui/AppToolbarLoadingDot.vue'

const props = withDefaults(
  defineProps<{
    showPager?: boolean
    loading?: boolean
    hasItems?: boolean
    skeletonRows?: number
  }>(),
  {
    showPager: false,
    loading: false,
    hasItems: false,
    skeletonRows: 6,
  },
)
</script>

<template>
  <div class="table-shell">
    <!-- Скелетон только пока данных ещё не было — без скачка при обновлении -->
    <div
      v-if="props.loading && !props.hasItems"
      key="loading"
      class="table-shell__state table-shell__state--skeleton"
    >
      <slot name="skeleton">
        <div class="table-shell__skeleton">
          <VaSkeletonGroup animation="wave">
            <VaSkeleton class="table-shell__skeleton-head" variant="text" :lines="1" />
            <VaSkeleton
              v-for="n in props.skeletonRows"
              :key="n"
              class="table-shell__skeleton-row"
              variant="rounded"
              height="2.85rem"
            />
          </VaSkeletonGroup>
        </div>
      </slot>
    </div>
    <div
      v-else-if="props.hasItems"
      key="data"
      class="table-shell__state table-shell__state--data"
    >
      <div
        class="table-shell__data-wrap"
        :class="{ 'table-shell__data-wrap--busy': props.loading }"
        :aria-busy="props.loading ? 'true' : 'false'"
      >
        <div
          v-if="props.loading"
          class="table-shell__busy-overlay"
          aria-live="polite"
        >
          <div class="table-shell__busy-dot-wrap">
            <AppToolbarLoadingDot />
          </div>
        </div>
        <slot />
      </div>
    </div>
    <div v-else key="empty" class="table-shell__state">
      <slot name="empty" />
    </div>
    <div v-if="props.showPager && props.hasItems" class="table-shell__pager">
      <slot name="pager" />
    </div>
  </div>
</template>

<style scoped>
.table-shell {
  display: grid;
  gap: 0.9rem;
}

.table-shell__state {
  min-height: 8rem;
}

.table-shell__state--skeleton {
  min-height: 14rem;
}

.table-shell__state--data {
  min-height: 0;
}

.table-shell__data-wrap {
  position: relative;
  transition: opacity 0.15s ease;
}

.table-shell__data-wrap--busy {
  opacity: 0.55;
  pointer-events: none;
}

.table-shell__busy-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.table-shell__busy-dot-wrap {
  transform: scale(1.85);
  transform-origin: center center;
}

.table-shell__skeleton {
  border: 1px solid var(--app-border);
  border-radius: 14px;
  padding: 0.8rem;
  background: var(--app-surface);
}

.table-shell__skeleton-head {
  margin-bottom: 0.6rem;
}

.table-shell__skeleton-row + .table-shell__skeleton-row {
  margin-top: 0.45rem;
}

.table-shell__pager {
  width: 100%;
  min-width: 0;
}
</style>
