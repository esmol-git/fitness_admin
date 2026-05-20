import { api } from '@/utils/api'

export type MembershipCatalogOption = {
  value: string
  text: string
  price: number | null
  durationValue: number | null
  durationUnit: 'DAY' | 'WEEK' | 'MONTH' | 'TRIAL' | null
}

type CatalogRow = {
  id: string
  name: string
  price?: number | null
  durationValue?: number | null
  durationUnit?: 'DAY' | 'WEEK' | 'MONTH' | 'TRIAL' | null
}

let activeCache: MembershipCatalogOption[] | null = null
let activeInflight: Promise<MembershipCatalogOption[]> | null = null

function mapCatalogRows(rows: CatalogRow[]): MembershipCatalogOption[] {
  return rows.map((item) => ({
    value: item.id,
    text: item.name,
    price: item.price == null ? null : Number(item.price),
    durationValue: item.durationValue ?? null,
    durationUnit: item.durationUnit ?? null,
  }))
}

function normalizeCatalogResponse(data: unknown): CatalogRow[] {
  if (Array.isArray(data)) return data as CatalogRow[]
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: CatalogRow[] }).items
  }
  return []
}

export function invalidateActiveMembershipCatalogCache() {
  activeCache = null
  activeInflight = null
}

export async function fetchActiveMembershipCatalogOptions(
  force = false,
): Promise<MembershipCatalogOption[]> {
  if (!force && activeCache) return activeCache
  if (!force && activeInflight) return activeInflight

  activeInflight = api
    .get('/membership-catalog', { params: { activeOnly: true } })
    .then(({ data }) => {
      const mapped = mapCatalogRows(normalizeCatalogResponse(data))
      activeCache = mapped
      return mapped
    })
    .catch(() => [] as MembershipCatalogOption[])
    .finally(() => {
      activeInflight = null
    })

  return activeInflight
}
