import type { LocationQuery } from 'vue-router'

export function normalizeRouteQuery(q: LocationQuery): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(q)) {
    if (v == null) continue
    const s = Array.isArray(v) ? v[0] : v
    if (s === '' || s == null) continue
    out[k] = String(s)
  }
  return out
}

export function routeQueryEquals(built: Record<string, string>, routeQ: LocationQuery): boolean {
  const n = normalizeRouteQuery(routeQ)
  const keys = new Set([...Object.keys(built), ...Object.keys(n)])
  for (const k of keys) {
    if ((built[k] ?? '') !== (n[k] ?? '')) return false
  }
  return true
}
