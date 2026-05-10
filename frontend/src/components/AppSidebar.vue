<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'

const props = defineProps<{
  collapsed?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
}>()

const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()
const logoutConfirmOpen = ref(false)
const logoutLoading = ref(false)

const items = computed(() => {
  if (auth.user?.role === 'MANAGER') {
    return [
      { to: '/', label: t('app.home'), icon: 'home', kind: 'link' as const },
      { to: '/clients', label: t('app.clients'), icon: 'badge', kind: 'link' as const },
      { to: '/visits', label: t('app.visits'), icon: 'meeting_room', kind: 'link' as const },
      { to: '/contracts', label: t('app.contracts'), icon: 'description', kind: 'link' as const },
      { to: '/payments', label: t('app.payments'), icon: 'payments', kind: 'link' as const },
    ]
  }
  const base = [
    { to: '/', label: t('app.home'), icon: 'home', kind: 'link' as const },
    { to: '/clients', label: t('app.clients'), icon: 'badge', kind: 'link' as const },
    { to: '/payments', label: t('app.payments'), icon: 'payments', kind: 'link' as const },
    { to: '/visits', label: t('app.visits'), icon: 'meeting_room', kind: 'link' as const },
    { to: '/reports', label: t('app.reports'), icon: 'assessment', kind: 'link' as const },
    { to: '/contracts', label: t('app.contracts'), icon: 'description', kind: 'link' as const },
    { to: '/settings', label: t('app.settings'), icon: 'settings', kind: 'link' as const },
    { to: '', label: t('sidebar.directories'), icon: '', kind: 'section' as const },
    { to: '/directories/memberships', label: t('app.memberships'), icon: 'confirmation_number', kind: 'link' as const },
  ]
  if (auth.user?.role === 'ADMIN') {
    base.push({ to: '/users', label: t('app.users'), icon: 'group', kind: 'link' as const })
  }
  return base
})

function askLogout() {
  logoutConfirmOpen.value = true
}

async function confirmLogout() {
  if (logoutLoading.value) return
  logoutLoading.value = true
  try {
    await auth.logout()
    logoutConfirmOpen.value = false
    await router.push({ name: 'login' })
  } finally {
    logoutLoading.value = false
  }
}

function initialsFromEmail(email: string) {
  const local = email.split('@')[0] ?? email
  const parts = local.split(/[._-]+/).filter(Boolean)
  if (parts.length >= 2) {
    const a = parts[0]
    const b = parts[1]
    if (a && b) return (a.charAt(0) + b.charAt(0)).toUpperCase()
  }
  return local.slice(0, 2).toUpperCase()
}

function displayNameFromEmail(email: string) {
  const local = email.split('@')[0] ?? email
  const parts = local.split(/[._-]+/).filter(Boolean)
  if (parts.length >= 2) {
    return parts
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join(' ')
  }
  return email
}

function initialsFromLogin(login: string) {
  return login.slice(0, 2).toUpperCase()
}

function initialsFromProfile(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  login: string,
  email: string | null | undefined,
) {
  const f = firstName?.trim() ?? ''
  const l = lastName?.trim() ?? ''
  if (f && l) return (f.charAt(0) + l.charAt(0)).toUpperCase()
  if (f.length >= 2) return f.slice(0, 2).toUpperCase()
  if (f.length === 1 && l) return (f.charAt(0) + l.charAt(0)).toUpperCase()
  if (f.length === 1) return f.charAt(0).toUpperCase()
  if (l.length >= 2) return l.slice(0, 2).toUpperCase()
  if (l.length === 1) return l.charAt(0).toUpperCase()
  if (email) return initialsFromEmail(email)
  return initialsFromLogin(login)
}

function displayNameFromProfile(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  login: string,
  email: string | null | undefined,
) {
  const f = firstName?.trim() ?? ''
  const l = lastName?.trim() ?? ''
  if (f || l) return [f, l].filter(Boolean).join(' ')
  if (email) return displayNameFromEmail(email)
  return login
}

const userCard = computed(() => {
  const u = auth.user
  if (!u) return null
  return {
    initials: initialsFromProfile(u.firstName, u.lastName, u.login, u.email),
    name: displayNameFromProfile(u.firstName, u.lastName, u.login, u.email),
    roleLabel: t(`users.roles.${u.role}`),
    subtitle: u.email ?? u.login,
  }
})
</script>

<template>
  <aside class="sidebar rounded-2xl" :class="{ 'sidebar--collapsed': props.collapsed }">
    <div class="sidebar-title" v-if="!props.collapsed">
      {{ t('sidebar.navigation') }}
    </div>
    <nav class="sidebar-nav">
      <template v-for="item in items" :key="`${item.kind}-${item.label}-${item.to}`">
        <div v-if="item.kind === 'section'" v-show="!props.collapsed" class="sidebar-group-title">
          {{ item.label }}
        </div>
        <RouterLink
          v-else
          :to="item.to"
          class="sidebar-link"
          :title="item.label"
        >
          <VaIcon :name="item.icon" size="18px" class="sidebar-link__icon" />
          <span v-if="!props.collapsed" class="sidebar-link__label">{{ item.label }}</span>
        </RouterLink>
      </template>
    </nav>
    <div class="sidebar-footer">
      <div
        v-if="userCard && !props.collapsed"
        class="sidebar-user"
        :title="userCard.subtitle"
      >
        <div class="sidebar-user__avatar" aria-hidden="true">{{ userCard.initials }}</div>
        <div class="sidebar-user__meta">
          <div class="sidebar-user__name">{{ userCard.name }}</div>
          <div class="sidebar-user__role">{{ userCard.roleLabel }}</div>
        </div>
      </div>
      <VaButton
        class="sidebar-logout"
        :class="{ 'sidebar-logout--icon-only': props.collapsed }"
        block
        preset="secondary"
        icon="logout"
        @click="askLogout"
      >
        <span v-if="!props.collapsed">{{ t('home.logout') }}</span>
      </VaButton>
    </div>
    <button class="sidebar-toggle" type="button" @click="emit('toggle')">
      <VaIcon :name="props.collapsed ? 'chevron_right' : 'chevron_left'" />
    </button>

    <ConfirmModal
      v-model="logoutConfirmOpen"
      :title="t('sidebar.logoutTitle')"
      :message="t('sidebar.logoutMessage')"
      :confirm-label="t('home.logout')"
      :cancel-label="t('common.cancel')"
      :loading="logoutLoading"
      @confirm="confirmLogout"
    />
  </aside>
</template>

<style scoped>
.sidebar {
  width: 288px;
  height: 100%;
  min-height: 0;
  background: var(--app-surface);
  color: var(--app-text);
  border: none;
  padding: 1rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  position: relative;
  transition: width 0.18s ease;
  box-shadow: var(--app-shadow-soft);
  border-radius: 16px;
}

.sidebar--collapsed {
  width: 72px;
}

.sidebar-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--app-muted);
  letter-spacing: 0.04em;
  margin: 0.25rem 0.5rem 0.75rem;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 0.2rem;
}

.sidebar-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.65rem;
  border-radius: 10px;
  padding: 0.55rem 0.65rem;
  color: var(--app-text);
  text-decoration: none;
  font-size: 0.98rem;
  font-weight: 500;
  line-height: 1.2;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.sidebar-link:hover {
  background: var(--app-sidebar-hover);
  transform: translateX(2px);
}

.sidebar-link.router-link-active {
  background: var(--app-sidebar-active-bg);
  color: var(--app-accent-strong);
  box-shadow: inset 0 0 0 1px var(--app-sidebar-active-ring);
}

.sidebar-link__icon {
  opacity: 0.9;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sidebar-link__label {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
}

.sidebar-group-title {
  margin: 0.55rem 0.55rem 0.25rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  color: var(--app-muted);
  letter-spacing: 0.045em;
  font-weight: 700;
}

.sidebar--collapsed .sidebar-link {
  justify-content: center;
  padding-left: 0.55rem;
  padding-right: 0.55rem;
}

.sidebar--collapsed .sidebar-link:hover {
  transform: none;
}

.sidebar-footer {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
  padding: 0.5rem 0.25rem 0.25rem;
}

.sidebar-logout {
  margin-top: 0.15rem;
  padding-top: 0.55rem;
  border-top: 1px solid var(--app-border);
}

.sidebar-user {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 0.65rem;
  padding: 0.6rem 0.65rem;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  box-sizing: border-box;
  width: 100%;
  text-align: left;
}

.sidebar-user__avatar {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 999px;
  background: var(--app-sidebar-hover);
  color: var(--app-text);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sidebar-user__meta {
  min-width: 0;
  flex: 1 1 auto;
  text-align: left;
}

.sidebar-user__name {
  font-size: 1.02rem;
  font-weight: 600;
  line-height: 1.25;
  color: var(--app-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-user__role {
  margin-top: 0.1rem;
  font-size: 0.875rem;
  color: var(--app-muted);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-logout:not(.sidebar-logout--icon-only) :deep(.va-button__content) {
  justify-content: flex-start;
  align-items: center;
  width: 100%;
  font-size: 1rem;
  font-weight: 600;
}

.sidebar-logout--icon-only :deep(.va-button__content) {
  justify-content: center;
  align-items: center;
}

.sidebar-toggle {
  position: absolute;
  top: 50%;
  right: -12px;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 0;
  background: var(--app-surface);
  color: var(--app-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: var(--app-shadow-soft);
}

.sidebar-toggle:hover {
  color: var(--app-text);
}

@media (max-width: 960px) {
  .sidebar {
    width: 100%;
    height: auto;
    min-height: unset;
    border-right: 0;
    border-bottom: 1px solid var(--app-border);
    padding: 0.75rem;
  }

  .sidebar-nav {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0.5rem;
    overflow: visible;
    padding-right: 0;
  }

  .sidebar-toggle {
    display: none;
  }
}
</style>
