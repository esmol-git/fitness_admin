import { nextTick, ref, watch, type Ref } from 'vue'
import type { LocationQuery, RouteLocationNormalizedLoaded, Router } from 'vue-router'
import {
  parseUserRoleFilterValue,
  USERS_ROLE_FILTER_ALL,
  type UsersRoleFilterValue,
} from '@/config/usersTable'
import { normalizeRouteQuery, routeQueryEquals } from '@/composables/tableListUrlQueryUtils'
import { DEFAULT_TABLE_PAGE_LIMIT, TABLE_PAGE_SIZES } from '@/config/tablePagination'
import type { TableSortOrder } from '@/types/table'

type SortOrder = TableSortOrder

export type ParsedUsersListQuery = {
  search: string
  role: UsersRoleFilterValue
  page: number
  limit: number
  sortBy: string | null
  sortOrder: SortOrder
}

export function parseUsersListRouteQuery(q: LocationQuery): ParsedUsersListQuery {
  const raw = normalizeRouteQuery(q)

  const search = raw.q ?? ''

  let role: UsersRoleFilterValue = USERS_ROLE_FILTER_ALL
  if (raw.role && raw.role !== 'all') {
    const parsed = parseUserRoleFilterValue(raw.role)
    if (parsed != null) role = parsed
  }

  let limit = Number(raw.limit)
  if (!Number.isFinite(limit) || !TABLE_PAGE_SIZES.includes(limit as (typeof TABLE_PAGE_SIZES)[number])) {
    limit = DEFAULT_TABLE_PAGE_LIMIT
  }

  let page = Number(raw.page)
  if (!Number.isFinite(page) || page < 1) page = 1

  let sortBy: string | null = 'createdAt'
  let sortOrder: SortOrder = 'desc'
  const sort = raw.sort ?? ''
  const colon = sort.indexOf(':')
  if (colon > 0) {
    const f = sort.slice(0, colon)
    const o = sort.slice(colon + 1)
    if (f === 'email' || f === 'login' || f === 'createdAt') {
      sortBy = f
      if (o === 'asc' || o === 'desc') sortOrder = o
    }
  }

  return { search, role, page, limit, sortBy, sortOrder }
}

export function buildUsersListRouteQuery(state: {
  search: string
  role: UsersRoleFilterValue
  page: number
  limit: number
  sortBy: string | null
  sortOrder: SortOrder
}): Record<string, string> {
  const out: Record<string, string> = {}
  const s = state.search.trim()
  if (s) out.q = s
  if (state.role && state.role !== USERS_ROLE_FILTER_ALL) out.role = state.role
  if (state.page > 1) out.page = String(state.page)
  if (state.limit !== DEFAULT_TABLE_PAGE_LIMIT) out.limit = String(state.limit)
  const defaultSort = state.sortBy === 'createdAt' && state.sortOrder === 'desc'
  if (!defaultSort && state.sortBy && state.sortOrder) {
    out.sort = `${state.sortBy}:${state.sortOrder}`
  }
  return out
}

function stateMatchesParsed(
  p: ParsedUsersListQuery,
  ctx: {
    debouncedSearch: Ref<string>
    filters: Ref<{ role?: UsersRoleFilterValue }>
    page: Ref<number>
    limit: Ref<number>
    sortBy: Ref<string | null>
    sortOrder: Ref<SortOrder>
  },
): boolean {
  return (
    ctx.debouncedSearch.value === p.search &&
    (ctx.filters.value.role ?? USERS_ROLE_FILTER_ALL) === p.role &&
    ctx.page.value === p.page &&
    ctx.limit.value === p.limit &&
    ctx.sortBy.value === p.sortBy &&
    ctx.sortOrder.value === p.sortOrder
  )
}

export function useUsersListUrlSync(
  route: RouteLocationNormalizedLoaded,
  router: Router,
  ctx: {
    debouncedSearch: Ref<string>
    filters: Ref<{ role?: UsersRoleFilterValue }>
    page: Ref<number>
    limit: Ref<number>
    sortBy: Ref<string | null>
    sortOrder: Ref<SortOrder>
    syncSearchImmediate: (v: string) => void
  },
) {
  const syncingFromRoute = ref(false)

  function applyRouteToState() {
    const p = parseUsersListRouteQuery(route.query)
    if (stateMatchesParsed(p, ctx)) return
    syncingFromRoute.value = true
    ctx.limit.value = p.limit
    ctx.syncSearchImmediate(p.search)
    ctx.filters.value = { ...ctx.filters.value, role: p.role }
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
  )

  watch(
    [
      () => ctx.debouncedSearch.value,
      ctx.page,
      ctx.limit,
      () => ctx.filters.value.role,
      ctx.sortBy,
      ctx.sortOrder,
    ],
    () => {
      if (syncingFromRoute.value) return
      const next = buildUsersListRouteQuery({
        search: ctx.debouncedSearch.value,
        role: ctx.filters.value.role ?? USERS_ROLE_FILTER_ALL,
        page: ctx.page.value,
        limit: ctx.limit.value,
        sortBy: ctx.sortBy.value,
        sortOrder: ctx.sortOrder.value,
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
