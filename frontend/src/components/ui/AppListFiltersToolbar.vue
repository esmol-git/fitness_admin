<template>
  <div class="app-list-filters-toolbar">
    <div class="app-list-filters-toolbar__filters">
      <slot />
    </div>
    <div class="app-list-filters-toolbar__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.app-list-filters-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
}

.app-list-filters-toolbar__filters {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  max-width: 100%;
}

.app-list-filters-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

@media (max-width: 760px) {
  .app-list-filters-toolbar {
    align-items: stretch;
    gap: 0.65rem;
  }
}
</style>
