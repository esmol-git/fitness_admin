import type { ClientStatus } from '@/types/clients'

export type ClientsListQueryInput = {
  page: number
  limit: number
  search?: string
  status?: ClientStatus | ''
  inGym?: 'IN_GYM' | 'OUT_GYM' | 'VISIT_OVERDUE' | ''
  membershipType?: string
  lastVisitFrom?: string
  lastVisitTo?: string
  gender?: 'MALE' | 'FEMALE' | ''
  ageFrom?: string
  ageTo?: string
  sortBy?: string | null
  sortOrder?: 'asc' | 'desc' | null
}

export function buildClientsListApiParams(query: ClientsListQueryInput): Record<string, string | number> {
  const safeParams: Record<string, string | number> = { page: query.page, limit: query.limit }
  const trimmedSearch = typeof query.search === 'string' ? query.search.trim() : ''
  if (trimmedSearch) safeParams.search = trimmedSearch
  if (
    query.status === 'ACTIVE' ||
    query.status === 'PAUSED' ||
    query.status === 'INACTIVE' ||
    query.status === 'BLOCKED'
  ) {
    safeParams.status = query.status
  }
  if (query.inGym === 'IN_GYM' || query.inGym === 'OUT_GYM' || query.inGym === 'VISIT_OVERDUE') {
    safeParams.inGym = query.inGym
  }
  const membershipType = typeof query.membershipType === 'string' ? query.membershipType.trim() : ''
  if (membershipType) safeParams.membershipType = membershipType
  if (typeof query.lastVisitFrom === 'string' && query.lastVisitFrom) {
    safeParams.lastVisitFrom = query.lastVisitFrom
  }
  if (typeof query.lastVisitTo === 'string' && query.lastVisitTo) {
    safeParams.lastVisitTo = query.lastVisitTo
  }
  if (query.gender === 'MALE' || query.gender === 'FEMALE') {
    safeParams.gender = query.gender
  }
  const ageFrom = typeof query.ageFrom === 'string' ? Number(query.ageFrom) : Number.NaN
  if (Number.isFinite(ageFrom) && ageFrom > 0) safeParams.ageFrom = Math.trunc(ageFrom)
  const ageTo = typeof query.ageTo === 'string' ? Number(query.ageTo) : Number.NaN
  if (Number.isFinite(ageTo) && ageTo > 0) safeParams.ageTo = Math.trunc(ageTo)
  if (
    query.sortBy === 'fullName' ||
    query.sortBy === 'phone' ||
    query.sortBy === 'createdAt' ||
    query.sortBy === 'inGym' ||
    query.sortBy === 'status' ||
    query.sortBy === 'age' ||
    query.sortBy === 'lastVisitAt'
  ) {
    safeParams.sortBy = query.sortBy
  }
  if (query.sortOrder === 'asc' || query.sortOrder === 'desc') {
    safeParams.sortOrder = query.sortOrder
  }
  return safeParams
}
