import { nextTick, ref, watch, type Ref } from 'vue'
import type { LocationQuery, RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { parseClientStatusFilterValue } from '@/config/clientsTable'
import { normalizeRouteQuery, routeQueryEquals } from '@/composables/tableListUrlQueryUtils'
import { DEFAULT_TABLE_PAGE_LIMIT, TABLE_PAGE_SIZES } from '@/config/tablePagination'
import type { ClientRow } from '@/types/clients'
import type { TableSortOrder } from '@/types/table'

type SortOrder = TableSortOrder

export type ClientsListFilters = {
  status?: ClientRow['status'] | ''
  inGym?: 'IN_GYM' | 'OUT_GYM' | 'VISIT_OVERDUE' | ''
  membershipType?: string
  lastVisitFrom?: string
  lastVisitTo?: string
  gender?: 'MALE' | 'FEMALE' | ''
  ageFrom?: string
  ageTo?: string
}

export type ParsedClientsListQuery = {
  search: string
  status: ClientRow['status'] | ''
  inGym: 'IN_GYM' | 'OUT_GYM' | 'VISIT_OVERDUE' | ''
  membershipType: string
  lastVisitFrom: string
  lastVisitTo: string
  gender: 'MALE' | 'FEMALE' | ''
  ageFrom: string
  ageTo: string
  page: number
  limit: number
  sortBy: string | null
  sortOrder: SortOrder
  /** Открыть карточку клиента по id (query `edit`). */
  editClientId: string
}

const DEFAULT_SORT_BY = 'lastVisitAt'
const DEFAULT_SORT_ORDER: SortOrder = 'desc'

const VALID_CLIENTS_SORT_FIELDS = [
  'fullName',
  'phone',
  'createdAt',
  'inGym',
  'status',
  'age',
  'lastVisitAt',
] as const

function isValidClientsSort(field: string, order: string): order is 'asc' | 'desc' {
  if (order !== 'asc' && order !== 'desc') return false
  return (VALID_CLIENTS_SORT_FIELDS as readonly string[]).includes(field)
}

export function parseClientsListRouteQuery(q: LocationQuery): ParsedClientsListQuery {
  const raw = normalizeRouteQuery(q)

  const search = raw.q ?? ''

  let status: ClientRow['status'] | '' = ''
  let inGym: 'IN_GYM' | 'OUT_GYM' | 'VISIT_OVERDUE' | '' = ''
  if (raw.gym === 'IN_GYM' || raw.gym === 'OUT_GYM' || raw.gym === 'VISIT_OVERDUE') {
    inGym = raw.gym
  }

  const membershipType = raw.membership ?? ''
  const lastVisitFrom = raw.visitFrom ?? ''
  const lastVisitTo = raw.visitTo ?? ''
  const gender = raw.gender === 'MALE' || raw.gender === 'FEMALE' ? raw.gender : ''
  const ageFrom = raw.ageFrom ?? ''
  const ageTo = raw.ageTo ?? ''

  if (raw.status) {
    const parsed = parseClientStatusFilterValue(raw.status)
    if (parsed != null) status = parsed
  }

  let limit = Number(raw.limit)
  if (!Number.isFinite(limit) || !TABLE_PAGE_SIZES.includes(limit as (typeof TABLE_PAGE_SIZES)[number])) {
    limit = DEFAULT_TABLE_PAGE_LIMIT
  }

  let page = Number(raw.page)
  if (!Number.isFinite(page) || page < 1) page = 1

  let sortBy: string | null = DEFAULT_SORT_BY
  let sortOrder: SortOrder = DEFAULT_SORT_ORDER
  const sort = raw.sort ?? ''
  const colon = sort.indexOf(':')
  if (colon > 0) {
    const f = sort.slice(0, colon)
    const o = sort.slice(colon + 1)
    if (isValidClientsSort(f, o)) {
      sortBy = f
      sortOrder = o
    }
  }

  const editRaw = (raw.edit ?? '').trim()
  const editClientId =
    editRaw && editRaw.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(editRaw) ? editRaw : ''

  return {
    search,
    status,
    inGym,
    membershipType,
    lastVisitFrom,
    lastVisitTo,
    gender,
    ageFrom,
    ageTo,
    page,
    limit,
    sortBy,
    sortOrder,
    editClientId,
  }
}

export function buildClientsListRouteQuery(state: {
  search: string
  status: ClientRow['status'] | ''
  inGym: 'IN_GYM' | 'OUT_GYM' | 'VISIT_OVERDUE' | ''
  membershipType: string
  lastVisitFrom: string
  lastVisitTo: string
  gender: 'MALE' | 'FEMALE' | ''
  ageFrom: string
  ageTo: string
  page: number
  limit: number
  sortBy: string | null
  sortOrder: SortOrder
  editClientId: string
}): Record<string, string> {
  const out: Record<string, string> = {}
  const s = state.search.trim()
  if (s) out.q = s
  if (state.status) out.status = state.status
  if (state.inGym) out.gym = state.inGym
  if (state.membershipType.trim()) out.membership = state.membershipType.trim()
  if (state.lastVisitFrom) out.visitFrom = state.lastVisitFrom
  if (state.lastVisitTo) out.visitTo = state.lastVisitTo
  if (state.gender) out.gender = state.gender
  if (state.ageFrom.trim()) out.ageFrom = state.ageFrom.trim()
  if (state.ageTo.trim()) out.ageTo = state.ageTo.trim()
  if (state.page > 1) out.page = String(state.page)
  if (state.limit !== DEFAULT_TABLE_PAGE_LIMIT) out.limit = String(state.limit)
  const defaultSort =
    state.sortBy === DEFAULT_SORT_BY && state.sortOrder === DEFAULT_SORT_ORDER
  if (!defaultSort && state.sortBy && state.sortOrder) {
    out.sort = `${state.sortBy}:${state.sortOrder}`
  }
  if (state.editClientId.trim()) out.edit = state.editClientId.trim()
  return out
}

function stateMatchesParsed(
  p: ParsedClientsListQuery,
  ctx: {
    debouncedSearch: Ref<string>
    filters: Ref<ClientsListFilters>
    page: Ref<number>
    limit: Ref<number>
    sortBy: Ref<string | null>
    sortOrder: Ref<SortOrder>
    editClientId: Ref<string>
  },
): boolean {
  return (
    ctx.debouncedSearch.value === p.search &&
    (ctx.filters.value.status ?? '') === p.status &&
    (ctx.filters.value.inGym ?? '') === p.inGym &&
    (ctx.filters.value.membershipType ?? '') === p.membershipType &&
    (ctx.filters.value.lastVisitFrom ?? '') === p.lastVisitFrom &&
    (ctx.filters.value.lastVisitTo ?? '') === p.lastVisitTo &&
    (ctx.filters.value.gender ?? '') === p.gender &&
    (ctx.filters.value.ageFrom ?? '') === p.ageFrom &&
    (ctx.filters.value.ageTo ?? '') === p.ageTo &&
    ctx.page.value === p.page &&
    ctx.limit.value === p.limit &&
    ctx.sortBy.value === p.sortBy &&
    ctx.sortOrder.value === p.sortOrder &&
    ctx.editClientId.value === p.editClientId
  )
}

export function useClientsListUrlSync(
  route: RouteLocationNormalizedLoaded,
  router: Router,
  ctx: {
    debouncedSearch: Ref<string>
    filters: Ref<ClientsListFilters>
    page: Ref<number>
    limit: Ref<number>
    sortBy: Ref<string | null>
    sortOrder: Ref<SortOrder>
    syncSearchImmediate: (v: string) => void
    editClientId: Ref<string>
  },
) {
  const syncingFromRoute = ref(false)

  function applyRouteToState() {
    const p = parseClientsListRouteQuery(route.query)
    if (stateMatchesParsed(p, ctx)) return
    syncingFromRoute.value = true
    ctx.editClientId.value = p.editClientId
    ctx.limit.value = p.limit
    ctx.syncSearchImmediate(p.search)
    ctx.filters.value = {
      ...ctx.filters.value,
      status: p.status,
      inGym: p.inGym,
      membershipType: p.membershipType,
      lastVisitFrom: p.lastVisitFrom,
      lastVisitTo: p.lastVisitTo,
      gender: p.gender,
      ageFrom: p.ageFrom,
      ageTo: p.ageTo,
    }
    ctx.sortBy.value = p.sortBy
    ctx.sortOrder.value = p.sortOrder
    ctx.page.value = p.page
    void nextTick(() => {
      syncingFromRoute.value = false
    })
  }

  watch(
    () => route.query,
    () => {
      if (syncingFromRoute.value) return
      applyRouteToState()
    },
    { immediate: true },
  )

  watch(
    [
      () => ctx.debouncedSearch.value,
      ctx.page,
      ctx.limit,
      () => ctx.filters.value.status,
      () => ctx.filters.value.inGym,
      () => ctx.filters.value.membershipType,
      () => ctx.filters.value.lastVisitFrom,
      () => ctx.filters.value.lastVisitTo,
      () => ctx.filters.value.gender,
      () => ctx.filters.value.ageFrom,
      () => ctx.filters.value.ageTo,
      ctx.sortBy,
      ctx.sortOrder,
      ctx.editClientId,
    ],
    () => {
      if (syncingFromRoute.value) return
      const next = buildClientsListRouteQuery({
        search: ctx.debouncedSearch.value,
        status: ctx.filters.value.status ?? '',
        inGym: ctx.filters.value.inGym ?? '',
        membershipType: ctx.filters.value.membershipType ?? '',
        lastVisitFrom: ctx.filters.value.lastVisitFrom ?? '',
        lastVisitTo: ctx.filters.value.lastVisitTo ?? '',
        gender: ctx.filters.value.gender ?? '',
        ageFrom: ctx.filters.value.ageFrom ?? '',
        ageTo: ctx.filters.value.ageTo ?? '',
        page: ctx.page.value,
        limit: ctx.limit.value,
        sortBy: ctx.sortBy.value,
        sortOrder: ctx.sortOrder.value,
        editClientId: ctx.editClientId.value,
      })
      if (routeQueryEquals(next, route.query)) return
      syncingFromRoute.value = true
      void router.replace({ query: next }).finally(() => {
        void nextTick(() => {
          syncingFromRoute.value = false
        })
      })
    },
    { flush: 'post' },
  )
}
