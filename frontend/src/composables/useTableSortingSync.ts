import { computed, type Ref } from 'vue'
import type { TableSortOrder } from '@/types/table'

interface UseTableSortingSyncOptions {
  sortBy: Ref<string | null>
  sortOrder: Ref<TableSortOrder>
  setSort: (sortBy: string | null, sortOrder?: TableSortOrder) => void
  defaultSort: `${string}:${'asc' | 'desc'}`
}

export function useTableSortingSync(options: UseTableSortingSyncOptions) {
  const selectedSort = computed(() => {
    if (options.sortBy.value && options.sortOrder.value) {
      return `${options.sortBy.value}:${options.sortOrder.value}`
    }
    return options.defaultSort
  })

  function onSelectSort(value: unknown) {
    if (typeof value !== 'string') return
    const [field, order] = value.split(':')
    if (!field || !order) return
    options.setSort(field, order === 'asc' ? 'asc' : 'desc')
  }

  function onTableSortBy(value: string | null) {
    options.setSort(value, options.sortOrder.value ?? 'asc')
  }

  function onTableSortOrder(value: TableSortOrder) {
    options.setSort(options.sortBy.value, value ?? 'asc')
  }

  function resetSort() {
    const [field, order] = options.defaultSort.split(':')
    options.setSort(field ?? null, order === 'asc' ? 'asc' : 'desc')
  }

  return {
    selectedSort,
    onSelectSort,
    onTableSortBy,
    onTableSortOrder,
    resetSort,
  }
}
