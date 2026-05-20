import { nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { LocationQuery, RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { normalizeRouteQuery, routeQueryEquals } from '@/composables/tableListUrlQueryUtils'

export const SCANNER_MODAL_QUERY_KEYS = ['scanner', 'scanCode'] as const

const SCAN_CODE_MAX_LEN = 128

function parseScanCode(raw: string | undefined): string {
  return (raw ?? '').trim().slice(0, SCAN_CODE_MAX_LEN)
}

export type ParsedScannerModalQuery = {
  shouldOpen: boolean
  code: string
}

export function parseScannerModalRouteQuery(q: LocationQuery): ParsedScannerModalQuery {
  const raw = normalizeRouteQuery(q)
  const shouldOpen = raw.scanner === '1' || raw.scanner === 'true'
  return {
    shouldOpen,
    code: parseScanCode(raw.scanCode),
  }
}

export function buildScannerModalRouteQuery(
  routeQ: LocationQuery,
  state: { open: boolean; code: string },
): Record<string, string> {
  const base = normalizeRouteQuery(routeQ)
  for (const k of SCANNER_MODAL_QUERY_KEYS) {
    delete base[k]
  }
  if (!state.open) return base
  base.scanner = '1'
  const code = parseScanCode(state.code)
  if (code) base.scanCode = code
  return base
}

export function useScannerModalUrlSync(
  route: RouteLocationNormalizedLoaded,
  router: Router,
  ctx: {
    compact: ComputedRef<boolean>
    scannerOpen: Ref<boolean>
    scannerInputValue: Ref<string>
    isRouteSyncBlocked: () => boolean
    applyFromRoute: (parsed: ParsedScannerModalQuery) => Promise<void>
  },
) {
  const syncingFromRoute = ref(false)

  watch(
    () => route.query,
    async () => {
      if (ctx.compact.value || ctx.isRouteSyncBlocked()) return
      syncingFromRoute.value = true
      try {
        const parsed = parseScannerModalRouteQuery(route.query)
        await ctx.applyFromRoute(parsed)
      } finally {
        await nextTick()
        syncingFromRoute.value = false
      }
    },
    { immediate: true },
  )

  watch(
    [ctx.scannerOpen, ctx.scannerInputValue],
    () => {
      if (ctx.compact.value || syncingFromRoute.value) return
      const next = buildScannerModalRouteQuery(route.query, {
        open: ctx.scannerOpen.value,
        code: ctx.scannerInputValue.value,
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
