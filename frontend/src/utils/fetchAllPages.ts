export const EXPORT_MAX_ROWS = 50_000

export class ExportTooManyRowsError extends Error {
  constructor(readonly total: number, readonly max: number) {
    super(`Export row limit exceeded: ${total} > ${max}`)
    this.name = 'ExportTooManyRowsError'
  }
}

export async function fetchAllPaginatedItems<T>(options: {
  fetchPage: (page: number, limit: number) => Promise<{ items: T[]; total: number }>
  pageSize?: number
  maxItems?: number
}): Promise<{ items: T[]; total: number }> {
  const pageSize = options.pageSize ?? 100
  const maxItems = options.maxItems ?? EXPORT_MAX_ROWS
  const all: T[] = []
  let total = 0
  let page = 1

  while (all.length < maxItems) {
    const chunk = await options.fetchPage(page, pageSize)
    total = chunk.total
    if (!chunk.items.length) break
    all.push(...chunk.items)
    if (all.length >= total) break
    page += 1
  }

  if (total > maxItems) {
    throw new ExportTooManyRowsError(total, maxItems)
  }

  return { items: all, total }
}
