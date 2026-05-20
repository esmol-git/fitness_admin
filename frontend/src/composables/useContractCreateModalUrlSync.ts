import { nextTick, ref, watch, type Ref } from 'vue'
import type { LocationQuery, RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { normalizeRouteQuery, routeQueryEquals } from '@/composables/tableListUrlQueryUtils'

export const CONTRACT_MODAL_QUERY_KEYS = [
  'clientId',
  'newContract',
  'queueContract',
  'contractNumber',
] as const

/** Устаревшие ключи с ПДн — убираем из URL при синхронизации модалки. */
export const CONTRACT_MODAL_LEGACY_QUERY_KEYS = [
  'firstName',
  'lastName',
  'middleName',
  'birthDate',
  'phone',
  'email',
  'address',
  'passportNumber',
  'serviceName',
  'servicePrice',
  'contractDate',
  'serviceStartDate',
  'serviceEndDate',
  'clubAddress',
  'passportIssuedBy',
  'passportIssuedAt',
  'executorName',
  'executorRepresentative',
] as const

const ALL_MODAL_STRIP_KEYS = [...CONTRACT_MODAL_QUERY_KEYS, ...CONTRACT_MODAL_LEGACY_QUERY_KEYS]

function parseClientId(raw: string | undefined): string {
  const s = (raw ?? '').trim()
  if (s && s.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(s)) return s
  return ''
}

export type ParsedContractCreateModalQuery = {
  shouldOpen: boolean
  clientId: string
  queueContract: boolean
  contractNumber: string
}

export function parseContractCreateModalRouteQuery(
  q: LocationQuery,
  options: { managerReadOnly: boolean },
): ParsedContractCreateModalQuery {
  const raw = normalizeRouteQuery(q)
  const newContract = raw.newContract === '1' || raw.newContract === 'true'
  const clientId = parseClientId(raw.clientId)
  let shouldOpen = false
  if (newContract && clientId) {
    // Из карточки клиента — открываем даже для read-only менеджера на странице договоров.
    shouldOpen = true
  } else if (newContract) {
    shouldOpen = !options.managerReadOnly
  } else if (clientId) {
    shouldOpen = !options.managerReadOnly
  }
  return {
    shouldOpen,
    clientId,
    queueContract: raw.queueContract === '1' || raw.queueContract === 'true',
    contractNumber: raw.contractNumber ?? '',
  }
}

export function buildContractCreateModalRouteQuery(
  routeQ: LocationQuery,
  state: {
    open: boolean
    clientId: string
    queueContract: boolean
    contractNumber: string
  },
): Record<string, string> {
  const base = normalizeRouteQuery(routeQ)
  for (const k of ALL_MODAL_STRIP_KEYS) {
    delete base[k]
  }
  if (!state.open) return base
  base.newContract = '1'
  const cid = state.clientId.trim()
  if (cid) base.clientId = cid
  if (state.queueContract) base.queueContract = '1'
  const cn = state.contractNumber.trim()
  if (cn) base.contractNumber = cn
  return base
}

export function useContractCreateModalUrlSync(
  route: RouteLocationNormalizedLoaded,
  router: Router,
  ctx: {
    createContractModalOpen: Ref<boolean>
    clientId: Ref<string>
    queueWithoutStart: Ref<boolean>
    contractNumber: Ref<string>
    managerReadOnly: Ref<boolean>
    isRouteSyncBlocked: () => boolean
    applyFromRoute: (parsed: ParsedContractCreateModalQuery) => Promise<void>
  },
) {
  const syncingFromRoute = ref(false)

  watch(
    () => route.query,
    async () => {
      if (ctx.isRouteSyncBlocked()) return
      syncingFromRoute.value = true
      try {
        const parsed = parseContractCreateModalRouteQuery(route.query, {
          managerReadOnly: ctx.managerReadOnly.value,
        })
        await ctx.applyFromRoute(parsed)
      } finally {
        await nextTick()
        syncingFromRoute.value = false
      }
    },
    { immediate: true },
  )

  watch(
    [ctx.createContractModalOpen, ctx.clientId, ctx.queueWithoutStart, ctx.contractNumber],
    () => {
      if (syncingFromRoute.value || ctx.isRouteSyncBlocked()) return
      const next = buildContractCreateModalRouteQuery(route.query, {
        open: ctx.createContractModalOpen.value,
        clientId: ctx.clientId.value,
        queueContract: ctx.queueWithoutStart.value,
        contractNumber: ctx.contractNumber.value,
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

  return { syncingFromRoute }
}
