import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

/** Имена маршрутов, доступных менеджеру; остальные при необходимости auth перенаправляются на дашборд. */
export const MANAGER_ALLOWED_ROUTE_NAMES = new Set([
  'home',
  'clients',
  'visits',
  'contracts',
  'payments',
  'not-found',
])

export function useManagerScope() {
  const auth = useAuthStore()
  const isManager = computed(() => auth.user?.role === 'MANAGER')
  const isManagerReadOnly = computed(() => isManager.value)
  return { isManager, isManagerReadOnly }
}
