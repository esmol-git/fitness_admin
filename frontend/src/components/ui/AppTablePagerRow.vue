<script setup lang="ts">
import AppTablePageSize from '@/components/ui/AppTablePageSize.vue'
import AppTablePagination from '@/components/ui/AppTablePagination.vue'

const limit = defineModel<number>('limit', { required: true })
const page = defineModel<number>('page', { required: true })

withDefaults(
  defineProps<{
    pages: number
    disabled?: boolean
    sizes?: readonly number[]
  }>(),
  {
    disabled: false,
  },
)

function onPageSizeChange() {
  page.value = 1
}
</script>

<template>
  <div class="app-table-pager-row">
    <AppTablePageSize v-model="limit" :disabled="disabled" :sizes="sizes" @change="onPageSizeChange" />
    <AppTablePagination
      v-model="page"
      class="app-table-pager-row__pagination"
      :pages="pages"
      :disabled="disabled"
    />
  </div>
</template>

<style scoped>
.app-table-pager-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.app-table-pager-row__pagination {
  display: flex;
  justify-content: flex-end;
  flex: 1;
  min-width: 0;
}

@media (max-width: 640px) {
  .app-table-pager-row {
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: stretch;
    gap: 0.65rem;
  }

  .app-table-pager-row__pagination {
    flex: none;
    width: 100%;
    max-width: 100%;
    justify-content: flex-start;
  }
}
</style>
