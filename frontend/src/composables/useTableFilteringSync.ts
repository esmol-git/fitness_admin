interface UseTableFilteringSyncOptions<F extends Record<string, unknown>> {
  patchFilters: (next: Partial<F>) => void
  resetFilters: () => void
  onAfterReset?: () => void
}

export function useTableFilteringSync<F extends Record<string, unknown>>(
  options: UseTableFilteringSyncOptions<F>,
) {
  function setFilter<K extends keyof F>(key: K, value: F[K]) {
    options.patchFilters({ [key]: value } as unknown as Partial<F>)
  }

  function createStringFilterHandler<K extends keyof F>(
    key: K,
    parse: (value: string) => F[K] | null,
  ) {
    return (value: unknown) => {
      if (typeof value !== 'string') return
      const parsed = parse(value)
      if (parsed === null) return
      setFilter(key, parsed)
    }
  }

  function resetAllFilters() {
    options.resetFilters()
    options.onAfterReset?.()
  }

  return {
    setFilter,
    createStringFilterHandler,
    resetAllFilters,
  }
}
