import { computed, onScopeDispose, ref, watch } from 'vue'
import { DEFAULT_TABLE_PAGE_LIMIT } from '@/config/tablePagination'

type SortOrder = 'asc' | 'desc' | null

interface UseTableStateOptions<F extends Record<string, unknown>> {
  initialPage?: number
  initialLimit?: number
  initialSearch?: string
  initialFilters?: F
  initialSortBy?: string | null
  initialSortOrder?: SortOrder
  searchDebounceMs?: number
  /** Первый кадр — скелетон, пока не завершится первая загрузка (useTableDataSource) */
  initialLoading?: boolean
}

export function useTableState<T, F extends Record<string, unknown> = Record<string, never>>(
  options: UseTableStateOptions<F> = {},
) {
  const initialFilters = { ...options.initialFilters } as F
  const items = ref<T[]>([])
  const total = ref(0)
  const page = ref(options.initialPage ?? 1)
  const limit = ref(options.initialLimit ?? DEFAULT_TABLE_PAGE_LIMIT)
  const search = ref(options.initialSearch ?? '')
  const debouncedSearch = ref(search.value)
  const filters = ref<F>({ ...initialFilters })
  const sortBy = ref<string | null>(options.initialSortBy ?? null)
  const sortOrder = ref<SortOrder>(options.initialSortOrder ?? null)
  const loading = ref(options.initialLoading ?? false)
  const error = ref<string | null>(null)

  const query = computed(() => ({
    page: page.value,
    limit: limit.value,
    search: debouncedSearch.value,
    sortBy: sortBy.value,
    sortOrder: sortOrder.value,
    ...filters.value,
  }))

  const pages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))
  const hasActiveFilters = computed(() =>
    Object.values(filters.value).some((value) => {
      if (value == null) return false
      if (typeof value === 'string') return value.trim().length > 0
      if (Array.isArray(value)) return value.length > 0
      return true
    }),
  )

  const searchDebounceMs = options.searchDebounceMs ?? 300
  let timeout: ReturnType<typeof setTimeout> | null = null

  watch(search, (value) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      debouncedSearch.value = value
      page.value = 1
    }, searchDebounceMs)
  })

  onScopeDispose(() => {
    if (timeout) clearTimeout(timeout)
  })

  function setResult(payload: { items: T[]; total: number }) {
    items.value = payload.items
    total.value = payload.total
  }

  function resetError() {
    error.value = null
  }

  function applySearchNow() {
    if (timeout) clearTimeout(timeout)
    debouncedSearch.value = search.value
    page.value = 1
  }

  /** Синхронизация поиска с URL без сброса страницы и без отложенного debounce */
  function syncSearchImmediate(value: string) {
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
    search.value = value
    debouncedSearch.value = value
  }

  function setSort(nextSortBy: string | null, nextSortOrder: SortOrder = 'asc') {
    sortBy.value = nextSortBy
    sortOrder.value = nextSortBy ? nextSortOrder : null
    page.value = 1
  }

  function patchFilters(next: Partial<F>) {
    filters.value = { ...filters.value, ...next }
    page.value = 1
  }

  function resetFilters() {
    filters.value = { ...initialFilters }
    page.value = 1
  }

  return {
    items,
    total,
    page,
    limit,
    search,
    debouncedSearch,
    filters,
    sortBy,
    sortOrder,
    query,
    loading,
    error,
    pages,
    hasActiveFilters,
    setResult,
    resetError,
    applySearchNow,
    syncSearchImmediate,
    setSort,
    patchFilters,
    resetFilters,
  }
}
