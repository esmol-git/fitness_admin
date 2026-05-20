<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TableActionIcon } from '@/config/tableActionIcons'
import { createUsersTableColumns } from '@/config/usersTable'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import type { UserRow, UserRole } from '@/types/users'
import type { TableHeaderConfig, TableSortOrder } from '@/types/table'

const props = defineProps<{
  items: UserRow[]
  loading: boolean
  busy: boolean
  canDelete: boolean
  /** Нельзя удалять строку с этим id (текущий пользователь) */
  currentUserId?: string | null
  /** Сквозной номер строки при пагинации */
  page?: number
  pageSize?: number
  sortBy?: string | null
  sortOrder?: TableSortOrder
}>()

function isSelfRow(row: UserRow) {
  const id = props.currentUserId
  return id != null && id !== '' && row.id === id
}

function displayRowNumber(rowIndex: number) {
  const p = props.page ?? 1
  const size = props.pageSize ?? 10
  return (p - 1) * size + rowIndex + 1
}

function bindTableRow(item: Record<string, unknown>) {
  const id = props.currentUserId
  const rowId = item.id
  const isSelf = id != null && id !== '' && rowId === id
  return { class: isSelf ? 'users-table__row--self' : '' }
}

const emit = defineEmits<{
  (e: 'edit', row: UserRow): void
  (e: 'delete', row: UserRow): void
  (e: 'sortBy', value: string | null): void
  (e: 'sortOrder', value: TableSortOrder): void
}>()

const { t, locale } = useI18n()

function roleLabel(t: (key: string) => string, role: UserRole) {
  return t(`users.roles.${role}`)
}

function roleTone(role: UserRole): 'success' | 'warning' | 'info' | 'neutral' {
  if (role === 'ADMIN') return 'success'
  if (role === 'MANAGER') return 'info'
  if (role === 'RECEPTIONIST') return 'warning'
  return 'neutral'
}

function formatFullName(row: UserRow) {
  const parts = [row.firstName, row.lastName]
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => p.trim())
  if (parts.length === 0) return '—'
  return parts.join(' ')
}

function formatCreatedAt(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const loc = locale.value === 'ru' ? 'ru-RU' : 'en-US'
  return new Intl.DateTimeFormat(loc, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

const headerConfig = computed<TableHeaderConfig[]>(() => createUsersTableColumns(t))

function handleSortByUpdate(value: unknown) {
  emit('sortBy', typeof value === 'string' ? value : null)
}

function handleSortOrderUpdate(value: unknown) {
  if (value === 'asc' || value === 'desc' || value == null) {
    emit('sortOrder', (value ?? null) as TableSortOrder)
  }
}

type UsersTableRowClickPayload = {
  event: Event
  item: Record<string, unknown>
  itemIndex: number
}

function handleRowClick(payload: UsersTableRowClickPayload) {
  if (props.busy || props.loading) return
  const target = payload.event.target
  if (!(target instanceof Element)) return
  if (target.closest('.app-actions-cell')) return
  emit('edit', payload.item as UserRow)
}
</script>

<template>
  <VaDataTable
    class="users-data-table app-table-actions-last-col"
    clickable
    hoverable
    :items="items"
    :columns="headerConfig"
    :loading="loading"
    :row-bind="bindTableRow"
    :sort-by="props.sortBy ?? undefined"
    :sorting-order="props.sortOrder ?? undefined"
    @update:sort-by="handleSortByUpdate"
    @update:sorting-order="handleSortOrderUpdate"
    @row:click="handleRowClick"
  >
    <template #cell(rowNum)="{ rowIndex }">
      {{ displayRowNumber(rowIndex) }}
    </template>
    <template #cell(fullName)="{ rowData }">
      <span class="users-table__name">{{ formatFullName(rowData) }}</span>
    </template>
    <template #cell(login)="{ rowData }">
      <span class="users-table__login">{{ rowData.login || '—' }}</span>
    </template>
    <template #cell(email)="{ rowData }">
      <span class="users-table__email">{{ rowData.email?.trim() || '—' }}</span>
    </template>
    <template #cell(role)="{ rowData }">
      <StatusBadge
        v-if="rowData.role"
        :label="roleLabel($t, rowData.role)"
        :tone="roleTone(rowData.role)"
      />
      <span v-else>—</span>
    </template>
    <template #cell(createdAt)="{ rowData }">
      {{ formatCreatedAt(rowData.createdAt) }}
    </template>
    <template #cell(actions)="{ rowData }">
      <div class="app-actions-cell" @click.stop>
        <VaButton
          size="large"
          preset="plain"
          :icon="TableActionIcon.edit"
          :aria-label="$t('users.edit')"
          :disabled="busy"
          @click="emit('edit', rowData)"
        />
        <VaButton
          v-if="canDelete"
          size="large"
          color="danger"
          preset="plain"
          :icon="TableActionIcon.delete"
          :aria-label="$t('users.delete')"
          :disabled="busy || isSelfRow(rowData)"
          :title="isSelfRow(rowData) ? $t('users.deleteSelfForbidden') : undefined"
          @click="emit('delete', rowData)"
        />
      </div>
    </template>
  </VaDataTable>
</template>

<style scoped>
:deep(.users-data-table tbody tr) {
  cursor: pointer;
}

:deep(tr.users-table__row--self) {
  background: color-mix(in srgb, var(--va-primary) 12%, var(--va-background-secondary));
  box-shadow: inset 3px 0 0 0 var(--va-primary);
}

:deep(tr.users-table__row--self:hover) {
  background: color-mix(in srgb, var(--va-primary) 18%, var(--va-background-secondary));
}

.users-table__name {
  font-weight: 600;
  color: var(--app-text);
}

.users-table__login {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: 0.84rem;
  color: color-mix(in srgb, var(--app-text) 88%, var(--app-muted));
}

.users-table__email {
  font-size: 0.875rem;
  color: var(--app-muted);
  word-break: break-all;
}
</style>
