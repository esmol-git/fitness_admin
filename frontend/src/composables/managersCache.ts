import { api } from '@/utils/api'

export type ManagerOption = {
  value: string
  text: string
}

let cache: ManagerOption[] | null = null
let inflight: Promise<ManagerOption[]> | null = null

export function invalidateManagerOptionsCache() {
  cache = null
  inflight = null
}

export async function fetchManagerOptions(force = false): Promise<ManagerOption[]> {
  if (!force && cache) return cache
  if (!force && inflight) return inflight

  inflight = api
    .get('/users', {
      params: { page: 1, limit: 100, role: 'MANAGER', sortBy: 'login', sortOrder: 'asc' },
    })
    .then(({ data }) => {
      const mapped = (data.items as Array<{ id: string; firstName?: string; lastName?: string; login: string }>).map(
        (u) => ({
          value: u.id,
          text: [u.lastName, u.firstName].filter(Boolean).join(' ').trim() || u.login,
        }),
      )
      cache = mapped
      return mapped
    })
    .catch(() => [] as ManagerOption[])
    .finally(() => {
      inflight = null
    })

  return inflight
}
