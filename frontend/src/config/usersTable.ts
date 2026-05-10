import type { TableHeaderConfig } from '@/types/table'
import type { UserRole } from '@/types/users'

type Translate = (key: string) => string

/** Непустое значение для VaSelect: пустая строка не отображается как выбранная опция */
export const USERS_ROLE_FILTER_ALL = '__ALL_ROLES__' as const

export type UsersRoleFilterValue = UserRole | typeof USERS_ROLE_FILTER_ALL

/** Роли, доступные для выбора на фронте (создание / фильтр / назначение). */
export const USER_ROLE_OPTIONS = ['ADMIN', 'MANAGER'] as const satisfies readonly UserRole[]

export function createUsersTableColumns(t: Translate): TableHeaderConfig[] {
  return [
    {
      key: 'rowNum',
      label: t('users.rowIndex'),
      width: '3.25rem',
      thAlign: 'right',
      tdAlign: 'right',
    },
    { key: 'fullName', label: t('users.fullName') },
    { key: 'login', label: t('users.login'), sortable: true },
    { key: 'email', label: t('users.email'), sortable: true },
    { key: 'role', label: t('users.role') },
    { key: 'createdAt', label: t('users.createdAt'), sortable: true },
    {
      key: 'actions',
      label: t('users.actions'),
      width: '5.5rem',
      thAlign: 'right',
      tdAlign: 'right',
    },
  ]
}

/** Опции роли для VaSelect в форме (подпись из i18n, значение — код роли) */
export function createUserRoleSelectOptions(t: Translate) {
  return USER_ROLE_OPTIONS.map((role) => ({ text: t(`users.roles.${role}`), value: role }))
}

export function createUsersRoleFilterOptions(t: Translate) {
  return [
    { text: t('users.allRoles'), value: USERS_ROLE_FILTER_ALL },
    ...createUserRoleSelectOptions(t),
  ]
}

export function parseUserRoleFilterValue(value: string): UsersRoleFilterValue | null {
  if (value === USERS_ROLE_FILTER_ALL) return USERS_ROLE_FILTER_ALL
  return (USER_ROLE_OPTIONS as readonly string[]).includes(value) ? (value as UserRole) : null
}
