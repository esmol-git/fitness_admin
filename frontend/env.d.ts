/// <reference types="vite/client" />

export {}

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    guestOnly?: boolean
    roles?: string[]
    /** Без сайдбара, компактный хедер (логин, 404 для авторизованных, др.) */
    standaloneLayout?: boolean
  }
}
