import { defineStore } from 'pinia'
import axios from 'axios'

const apiBase =
  import.meta.env.VITE_API_URL?.toString() ||
  (import.meta.env.DEV ? '/api' : '/api')

export type AuthUser = {
  id: string
  login: string
  email: string | null
  role: string
  firstName?: string | null
  lastName?: string | null
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: null as string | null,
    user: null as AuthUser | null,
  }),
  persist: true,
  actions: {
    setSession(token: string, user: AuthUser) {
      this.accessToken = token
      this.user = user
    },
    async logout() {
      this.accessToken = null
      this.user = null
      try {
        await axios.post(
          `${apiBase}/auth/logout`,
          {},
          { headers: { 'Content-Type': 'application/json' }, withCredentials: true },
        )
      } catch {
        // ignore logout network errors
      }
    },
    async login(login: string, password: string) {
      const { data } = await axios.post<{
        access_token: string
        user: AuthUser
      }>(
        `${apiBase}/auth/login`,
        { login: login.trim().toLowerCase(), password },
        { headers: { 'Content-Type': 'application/json' }, withCredentials: true },
      )
      this.setSession(data.access_token, data.user)
    },
    async loadMe() {
      if (!this.accessToken) return
      const { api } = await import('@/utils/api')
      const { data } = await api.get<AuthUser>('/auth/me')
      this.user = data
    },
  },
})
