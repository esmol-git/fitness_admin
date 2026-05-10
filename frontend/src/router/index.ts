import { createRouter, createWebHistory } from 'vue-router'
import axios from 'axios'
import { MANAGER_ALLOWED_ROUTE_NAMES } from '@/composables/useManagerScope'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/about',
      name: 'about',
      component: () => import('@/views/AboutView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/users',
      name: 'users',
      component: () => import('@/views/UsersView.vue'),
      meta: { requiresAuth: true, roles: ['ADMIN'] },
    },
    {
      path: '/clients',
      name: 'clients',
      component: () => import('@/views/ClientsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/directories/memberships',
      name: 'directory-memberships',
      component: () => import('@/views/MembershipDirectoryView.vue'),
      meta: { requiresAuth: true },
    },
    { path: '/memberships', redirect: '/directories/memberships' },
    {
      path: '/schedule',
      name: 'schedule',
      component: () => import('@/views/ModuleStubView.vue'),
      props: { titleKey: 'app.schedule', icon: 'calendar_month' },
      meta: { requiresAuth: true },
    },
    { path: '/attendance', redirect: '/visits' },
    {
      path: '/payments',
      name: 'payments',
      component: () => import('@/views/PaymentsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/visits',
      name: 'visits',
      component: () => import('@/views/VisitsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/reports',
      name: 'reports',
      component: () => import('@/views/ReportsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/contracts',
      name: 'contracts',
      component: () => import('@/views/ContractsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { requiresAuth: true, standaloneLayout: true },
    },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  if (auth.accessToken && !auth.user) {
    try {
      await auth.loadMe()
    } catch (e: unknown) {
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        await auth.logout()
      } else {
        useUiStore().setPendingNotice('network')
      }
    }
  }

  if (to.meta.requiresAuth && !auth.accessToken) {
    return { name: 'login' }
  }

  if (to.meta.guestOnly && auth.accessToken) {
    return { name: 'home' }
  }

  const roles = to.meta.roles as string[] | undefined
  if (roles?.length && auth.user && !roles.includes(auth.user.role)) {
    useUiStore().setPendingNotice('forbidden')
    return { name: 'home' }
  }

  if (auth.user?.role === 'MANAGER' && to.meta.requiresAuth) {
    const name = to.name
    if (typeof name === 'string' && !MANAGER_ALLOWED_ROUTE_NAMES.has(name)) {
      useUiStore().setPendingNotice('forbidden')
      return { name: 'home' }
    }
  }
})

export default router
