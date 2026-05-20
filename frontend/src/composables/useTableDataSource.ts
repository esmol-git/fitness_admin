import { watch, type Ref } from 'vue'

interface TableDataResponse<T> {
  items: T[]
  total: number
}

interface UseTableDataSourceOptions<T, Q> {
  query: Ref<Q>
  loading: Ref<boolean>
  setResult: (payload: TableDataResponse<T>) => void
  fetcher: (query: Q) => Promise<TableDataResponse<T>>
  error?: Ref<string | null>
  resetError?: () => void
  mapError?: (error: unknown) => string
  immediate?: boolean
  /** Не скрывать скелетон раньше N мс (убирает «мигание» при очень быстром ответе API) */
  minLoadingMs?: number
}

function serializeTableQuery<Q>(query: Q): string {
  return JSON.stringify(query)
}

export function useTableDataSource<T, Q>(options: UseTableDataSourceOptions<T, Q>) {
  let requestSeq = 0
  let lastFetchedQueryKey: string | null = null

  async function reload(force = false) {
    const queryKey = serializeTableQuery(options.query.value)
    if (!force && queryKey === lastFetchedQueryKey) return

    const currentSeq = ++requestSeq
    const startedAt = Date.now()
    options.loading.value = true
    options.resetError?.()
    try {
      const payload = await options.fetcher(options.query.value)
      if (currentSeq !== requestSeq) return
      options.setResult(payload)
      lastFetchedQueryKey = queryKey
    } catch (error: unknown) {
      if (currentSeq !== requestSeq) return
      if (options.error && options.mapError) {
        options.error.value = options.mapError(error)
      }
    } finally {
      if (currentSeq !== requestSeq) return
      const minMs = options.minLoadingMs ?? 0
      if (minMs > 0) {
        const elapsed = Date.now() - startedAt
        if (elapsed < minMs) {
          await new Promise((r) => setTimeout(r, minMs - elapsed))
        }
      }
      options.loading.value = false
    }
  }

  watch(
    options.query,
    () => {
      void reload()
    },
    { immediate: options.immediate ?? true, deep: true },
  )

  return {
    reload,
  }
}
