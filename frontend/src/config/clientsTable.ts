import type { TableHeaderConfig } from '@/types/table'
import type { ClientRow } from '@/types/clients'

type Translate = (key: string) => string

export function createClientsTableColumns(t: Translate): TableHeaderConfig[] {
  return [
    { key: 'photo', label: ' ' },
    { key: 'fullName', label: t('clients.fullName'), sortable: true },
    { key: 'inGym', label: t('clients.inGym'), sortable: true },
    { key: 'phone', label: t('clients.phone') },
    { key: 'membershipType', label: t('clients.membership') },
    { key: 'contractDaysLeft', label: t('clients.daysLeftColumn'), thAlign: 'right', tdAlign: 'right' },
    { key: 'status', label: t('clients.statusLabel'), sortable: true },
    { key: 'age', label: t('clients.age'), sortable: true },
    { key: 'gender', label: t('clients.genderLabel') },
    { key: 'lastVisitAt', label: t('clients.lastVisitDate') },
    { key: 'actions', label: t('clients.actions') },
  ]
}

export function createClientsStatusFilterOptions(t: Translate) {
  return [
    { text: t('clients.statusAll'), value: '' },
    { text: t('clients.status.ACTIVE'), value: 'ACTIVE' },
    { text: t('clients.status.PAUSED'), value: 'PAUSED' },
    { text: t('clients.status.INACTIVE'), value: 'INACTIVE' },
    { text: t('clients.status.BLOCKED'), value: 'BLOCKED' },
  ]
}

export function createClientsSortOptions(t: Translate) {
  return [
    { text: t('clients.sortNameAsc'), value: 'fullName:asc' },
    { text: t('clients.sortNameDesc'), value: 'fullName:desc' },
    { text: t('clients.sortCreatedDesc'), value: 'createdAt:desc' },
    { text: t('clients.sortCreatedAsc'), value: 'createdAt:asc' },
  ]
}

export function parseClientStatusFilterValue(value: string): ClientRow['status'] | '' | null {
  return ['', 'ACTIVE', 'PAUSED', 'INACTIVE', 'BLOCKED'].includes(value)
    ? (value as ClientRow['status'] | '')
    : null
}
