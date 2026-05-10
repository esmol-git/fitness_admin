import axios from 'axios'
import type { AuthUser } from '@/stores/auth'
import { useAuthStore } from '@/stores/auth'

const baseURL =
  import.meta.env.VITE_API_URL?.toString() ||
  (import.meta.env.DEV ? '/api' : '/api')

export const api = axios.create({
  baseURL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

let refreshPromise: Promise<{ access_token: string; user: AuthUser }> | null = null

api.interceptors.request.use((config) => {
  const token = useAuthStore().accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

function isAuthPublicRequest(url: string | undefined) {
  if (!url) return false
  const path = url.includes('://') ? new URL(url).pathname : url
  return (
    path.includes('auth/login') ||
    path.includes('auth/refresh') ||
    path.includes('auth/logout')
  )
}

async function performRefresh() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post<{ access_token: string; user: AuthUser }>(
        `${baseURL}/auth/refresh`,
        {},
        { headers: { 'Content-Type': 'application/json' }, withCredentials: true },
      )
      .then((res) => res.data)
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const noResponse = error.response == null && error.config != null
      if (noResponse) {
        const code = error.code
        const reqUrl = error.config?.url
        if (
          (code === 'ERR_NETWORK' || code === 'ECONNABORTED') &&
          !isAuthPublicRequest(reqUrl)
        ) {
          const { useUiStore } = await import('@/stores/ui')
          useUiStore().setPendingNotice('network')
        }
      }

      if (error.response?.status === 401) {
        const originalRequest = error.config
        const reqUrl = originalRequest?.url
        if (isAuthPublicRequest(reqUrl)) {
          return Promise.reject(error)
        }

        const auth = useAuthStore()
        if (
          originalRequest &&
          !(originalRequest as { _retryRefresh?: boolean })._retryRefresh
        ) {
          ;(originalRequest as { _retryRefresh?: boolean })._retryRefresh = true
          try {
            const data = await performRefresh()
            auth.setSession(data.access_token, data.user)
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${data.access_token}`
            }
            return api(originalRequest)
          } catch {
            await auth.logout()
            const { default: router } = await import('@/router')
            if (router.currentRoute.value.name !== 'login') {
              await router.push({ name: 'login', query: { session: 'expired' } })
            }
            return Promise.reject(error)
          }
        }

        await auth.logout()
        const { default: router } = await import('@/router')
        if (router.currentRoute.value.name !== 'login') {
          await router.push({ name: 'login', query: { session: 'expired' } })
        }
      }
    }
    return Promise.reject(error)
  },
)
