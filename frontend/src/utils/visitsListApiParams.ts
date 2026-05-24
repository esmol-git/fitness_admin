export type VisitsListQueryInput = {
  page: number
  limit: number
  search?: string
  state?: string
  from?: string
  to?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export function buildVisitsListApiParams(query: VisitsListQueryInput): Record<string, string> {
  const params: Record<string, string> = {
    page: String(query.page),
    limit: String(query.limit),
    sortBy: query.sortBy ?? 'enteredAt',
    sortOrder: query.sortOrder ?? 'desc',
  }
  if (query.search?.trim()) params.search = query.search.trim()
  if (query.state === 'IN_GYM' || query.state === 'LEFT') {
    params.state = query.state
  }
  if (query.from) params.from = query.from
  if (query.to) params.to = query.to
  return params
}
