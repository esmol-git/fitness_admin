<script setup lang="ts">
import axios from 'axios'
import { computed, nextTick, ref, unref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'vuestic-ui'
import useVuelidate from '@vuelidate/core'
import { helpers, required } from '@vuelidate/validators'
import {
  createUserRoleSelectOptions,
  createUsersRoleFilterOptions,
  parseUserRoleFilterValue,
  USERS_ROLE_FILTER_ALL,
} from '@/config/usersTable'
import { useUserFormVuelidateRules } from '@/config/userFormVuelidateRules'
import { api } from '@/utils/api'
import UserFormFields from '@/components/users/UserFormFields.vue'
import UsersTable from '@/components/users/UsersTable.vue'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import AppDataTableShell from '@/components/ui/AppDataTableShell.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppFilterBar from '@/components/ui/AppFilterBar.vue'
import AppTablePagerRow from '@/components/ui/AppTablePagerRow.vue'
import { useTableDataSource } from '@/composables/useTableDataSource'
import { useTableFilteringSync } from '@/composables/useTableFilteringSync'
import { useCrudForm } from '@/composables/useCrudForm'
import { useFormTabNavigation } from '@/composables/useFormTabNavigation'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'
import { useTableSortingSync } from '@/composables/useTableSortingSync'
import { useTableState } from '@/composables/useTableState'
import { parseUsersListRouteQuery, useUsersListUrlSync } from '@/composables/useUsersListUrlSync'
import { useAuthStore } from '@/stores/auth'
import type { UserForm, UserRole, UserRow } from '@/types/users'

const { t } = useI18n()
const { init: notify } = useToast()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const urlInit = parseUsersListRouteQuery(route.query)

const table = useTableState<UserRow, { role?: UserRole | typeof USERS_ROLE_FILTER_ALL }>({
  initialLimit: urlInit.limit,
  initialPage: urlInit.page,
  initialSearch: urlInit.search,
  initialFilters: { role: urlInit.role },
  initialSortBy: urlInit.sortBy,
  initialSortOrder: urlInit.sortOrder ?? 'desc',
  searchDebounceMs: 450,
  initialLoading: true,
})
const {
  items,
  total,
  page,
  limit,
  search,
  loading,
  error,
  query,
  filters,
  sortBy,
  sortOrder,
  setResult,
  resetError,
  applySearchNow,
  syncSearchImmediate,
  patchFilters,
  setSort,
  resetFilters,
  debouncedSearch,
} = table

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))

const createState = useCrudForm<UserForm>(() => ({
  firstName: '',
  lastName: '',
  birthDate: '',
  login: '',
  email: '',
  password: '',
  passwordConfirm: '',
  role: 'MANAGER',
  phone: '',
}))

const editState = useCrudForm<UserForm>(() => ({
  firstName: '',
  lastName: '',
  birthDate: '',
  login: '',
  email: '',
  password: '',
  passwordConfirm: '',
  role: 'MANAGER',
  phone: '',
}))

const editingUserId = ref<string | null>(null)
const originalEditLogin = ref<string | null>(null)
const createSubmitAttempted = ref(false)
const editSubmitAttempted = ref(false)

const baseCreateRules = useUserFormVuelidateRules((key: string) => t(key), 'create')
const createRules = computed(() => ({
  ...baseCreateRules.value,
  passwordConfirm: {
    required: helpers.withMessage(() => t('users.validation.passwordConfirmRequired'), required),
    match: helpers.withMessage(
      () => t('users.validation.passwordMismatch'),
      (c: unknown) => {
        const p = createState.form.value.password
        return String(c ?? '') === p && p.length >= 8
      },
    ),
  },
}))

const baseEditRules = useUserFormVuelidateRules((key: string) => t(key), 'edit', {
  allowLegacyLogin: (value: string) => {
    const original = originalEditLogin.value
    if (!original) return false
    return value.trim().toLowerCase() === original.trim().toLowerCase()
  },
})
const editRules = computed(() => ({
  ...baseEditRules.value,
  passwordConfirm: {
    match: helpers.withMessage(
      () => t('users.validation.passwordMismatch'),
      (c: unknown) => {
        const p = editState.form.value.password
        const conf = String(c ?? '')
        if (!p) return conf.length === 0
        return conf === p
      },
    ),
  },
}))

const vCreate$ = useVuelidate(createRules, createState.form, { $autoDirty: true })
const vEdit$ = useVuelidate(editRules, editState.form, { $autoDirty: true })

const createFormImmediateValidation = computed(() => createSubmitAttempted.value)
const editFormImmediateValidation = computed(() => editSubmitAttempted.value)

function showCreateFieldError(field: keyof UserForm) {
  const node = vCreate$.value[field] as
    | { $invalid?: boolean; $dirty?: boolean; $error?: boolean }
    | undefined
  if (!node) return false
  if (createSubmitAttempted.value) return Boolean(node.$invalid)
  return Boolean(node.$dirty && node.$error)
}

function createFieldErrorMessage(field: keyof UserForm) {
  const node = vCreate$.value[field] as
    | {
        $invalid?: boolean
        $dirty?: boolean
        $error?: boolean
        $errors?: { $message?: unknown }[]
        $silentErrors?: { $message?: unknown }[]
      }
    | undefined
  if (!node) return ''
  const show = createSubmitAttempted.value ? node.$invalid : node.$dirty && node.$error
  if (!show) return ''
  const first = node.$errors?.[0] ?? node.$silentErrors?.[0]
  if (!first?.$message) return ''
  return String(unref(first.$message))
}

function showEditFieldError(field: keyof UserForm) {
  const node = vEdit$.value[field] as
    | { $invalid?: boolean; $dirty?: boolean; $error?: boolean }
    | undefined
  if (!node) return false
  if (editSubmitAttempted.value) return Boolean(node.$invalid)
  return Boolean(node.$dirty && node.$error)
}

function editFieldErrorMessage(field: keyof UserForm) {
  const node = vEdit$.value[field] as
    | {
        $invalid?: boolean
        $dirty?: boolean
        $error?: boolean
        $errors?: { $message?: unknown }[]
        $silentErrors?: { $message?: unknown }[]
      }
    | undefined
  if (!node) return ''
  const show = editSubmitAttempted.value ? node.$invalid : node.$dirty && node.$error
  if (!show) return ''
  const first = node.$errors?.[0] ?? node.$silentErrors?.[0]
  if (!first?.$message) return ''
  return String(unref(first.$message))
}

const deleteOpen = ref(false)
const deleteLoading = ref(false)
const deleteError = ref<string | null>(null)
const deletingUser = ref<UserRow | null>(null)

const canAssignRole = computed(() => auth.user?.role === 'ADMIN')
const canDelete = computed(() => auth.user?.role === 'ADMIN')
const roleSelectOptionsCreate = computed(() => createUserRoleSelectOptions(t))
/** При редактировании пользователя со «старой» ролью показываем её в списке до смены. */
const roleSelectOptionsEdit = computed(() => {
  const base = createUserRoleSelectOptions(t)
  const r = editState.form.value.role
  if (!editState.open.value || !r || base.some((o) => o.value === r)) return base
  return [...base, { text: t(`users.roles.${r}`), value: r }]
})
const roleFilterOptions = computed(() => createUsersRoleFilterOptions(t))

const busy = computed(
  () => loading.value || createState.loading.value || editState.loading.value || deleteLoading.value,
)
const { onTableSortBy, onTableSortOrder, resetSort } = useTableSortingSync(
  {
    sortBy,
    sortOrder,
    setSort,
    defaultSort: 'createdAt:desc',
  },
)

const { createStringFilterHandler, resetAllFilters: resetTableFilters } = useTableFilteringSync({
  patchFilters,
  resetFilters,
  onAfterReset: resetSort,
})

const hasToolbarReset = computed(() => {
  const role = filters.value.role
  const roleNarrows = role != null && role !== USERS_ROLE_FILTER_ALL
  const sortDeviates = sortBy.value !== 'createdAt' || sortOrder.value !== 'desc'
  return roleNarrows || search.value.trim().length > 0 || sortDeviates
})

function resetToolbar() {
  search.value = ''
  applySearchNow()
  resetTableFilters()
}

const displayItems = computed(() => items.value)
const hasUsers = computed(() => items.value.length > 0)
const { onFormTabKeydown } = useFormTabNavigation()

useUsersListUrlSync(route, router, {
  debouncedSearch,
  filters,
  page,
  limit,
  sortBy,
  sortOrder,
  syncSearchImmediate,
})

const usersSource = useTableDataSource<UserRow, typeof query.value>({
  query,
  loading,
  error,
  resetError,
  setResult,
  fetcher: async (params) => {
    const safeParams: {
      page: number
      limit: number
      search?: string
      role?: UserRole
      sortBy?: 'login' | 'email' | 'createdAt'
      sortOrder?: 'asc' | 'desc'
    } = {
      page: params.page,
      limit: params.limit,
    }
    const trimmedSearch = typeof params.search === 'string' ? params.search.trim() : ''
    if (trimmedSearch) {
      safeParams.search = trimmedSearch
    }
    const role =
      params.role && params.role !== USERS_ROLE_FILTER_ALL ? params.role : undefined
    if (role) {
      safeParams.role = role
    }
    if (
      (params.sortBy === 'login' || params.sortBy === 'email' || params.sortBy === 'createdAt') &&
      (params.sortOrder === 'asc' || params.sortOrder === 'desc')
    ) {
      safeParams.sortBy = params.sortBy
      safeParams.sortOrder = params.sortOrder
    }

    let data: { items: UserRow[]; meta: { total: number; page: number; limit: number } }
    try {
      ({ data } = await api.get('/users', { params: safeParams }))
    } catch (e: unknown) {
      // Backward compatibility: some backend revisions reject `search` in query whitelist.
      if (
        axios.isAxiosError(e) &&
        e.response?.status === 400 &&
        Array.isArray(e.response.data?.message) &&
        e.response.data.message.some((m: unknown) =>
          String(m).toLowerCase().includes('search must not exist'),
        )
      ) {
        ({ data } = await api.get('/users', {
          params: { page: params.page, limit: params.limit },
        }))
      } else {
        throw e
      }
    }

    return { items: data.items, total: data.meta.total }
  },
  mapError: (e) =>
    resolveApiErrorMessage(e, {
      defaultMessage: t('users.loadFailed'),
      byStatus: {
        403: t('users.forbidden'),
      },
      byCode: {
        MANAGER_ROLE_FORBIDDEN: t('users.forbidden'),
      },
    }),
})

function openCreate() {
  createSubmitAttempted.value = false
  createState.openForm()
  void nextTick(() => {
    vCreate$.value.$reset()
  })
}

function closeCreateModal() {
  if (createState.loading.value) return
  createState.closeForm()
}

const onRoleFilter = createStringFilterHandler('role', (value) =>
  parseUserRoleFilterValue(value),
)

function buildPayload(source: UserForm, includePassword: boolean, isEdit: boolean) {
  const normalizedLogin = source.login.trim().toLowerCase()
  const payload: Record<string, unknown> = {
    firstName: source.firstName.trim(),
    lastName: source.lastName.trim(),
    phone: source.phone || undefined,
    isEmployee: true,
  }
  if (
    !isEdit ||
    normalizedLogin !== (originalEditLogin.value ?? '').trim().toLowerCase()
  ) {
    payload.login = normalizedLogin
  }
  const emailTrim = source.email.trim()
  if (isEdit) {
    payload.email = emailTrim ? emailTrim : null
  } else if (emailTrim) {
    payload.email = emailTrim
  }
  if (isEdit) {
    payload.birthDate = source.birthDate.trim() ? source.birthDate.trim() : null
  } else if (source.birthDate.trim()) {
    payload.birthDate = source.birthDate.trim()
  }
  if (includePassword) {
    payload.password = source.password
  } else if (source.password) {
    payload.password = source.password
  }
  if (canAssignRole.value) {
    payload.role = source.role
  }
  return payload
}

async function createUser() {
  if (createState.loading.value) return
  createSubmitAttempted.value = true
  const ok = await vCreate$.value.$validate()
  if (!ok) {
    createState.error.value = t('users.validationError')
    return
  }
  createState.loading.value = true
  createState.error.value = null
  try {
    await api.post('/users', buildPayload(createState.form.value, true, false))
    createState.closeForm()
    notify({
      message: t('users.createdSuccess'),
      color: 'success',
    })
    await usersSource.reload()
  } catch (e: unknown) {
    createState.error.value = resolveApiErrorMessage(e, {
      defaultMessage: t('users.createFailed'),
      byStatus: {
        400: t('users.validationError'),
        409: t('users.loginOrEmailExists'),
      },
      byCode: {
        LOGIN_OR_EMAIL_EXISTS: t('users.loginOrEmailExists'),
        MANAGER_ROLE_FORBIDDEN: t('users.forbidden'),
      },
    })
  } finally {
    createState.loading.value = false
  }
}

function openEdit(row: UserRow) {
  editingUserId.value = row.id
  originalEditLogin.value = row.login
  editSubmitAttempted.value = false
  editState.openForm({
    firstName: row.firstName ?? '',
    lastName: row.lastName ?? '',
    birthDate: row.birthDate ?? '',
    login: row.login,
    email: row.email ?? '',
    password: '',
    passwordConfirm: '',
    role: row.role,
    phone: row.phone ?? '',
  })
  void nextTick(() => {
    vEdit$.value.$reset()
  })
}

function closeEditModal() {
  if (editState.loading.value) return
  editState.closeForm()
}

function onCreateModalUpdate(open: boolean) {
  if (!open && createState.loading.value) return
  createState.open.value = open
}

function onEditModalUpdate(open: boolean) {
  if (!open && editState.loading.value) return
  editState.open.value = open
}

async function updateUser() {
  if (editState.loading.value) return
  if (!editingUserId.value) return
  editSubmitAttempted.value = true
  const ok = await vEdit$.value.$validate()
  if (!ok) {
    editState.error.value = t('users.validationError')
    return
  }
  editState.loading.value = true
  editState.error.value = null
  try {
    await api.patch(
      `/users/${editingUserId.value}`,
      buildPayload(editState.form.value, false, true),
    )
    editState.closeForm()
    editingUserId.value = null
    notify({
      message: t('users.updatedSuccess'),
      color: 'success',
    })
    await usersSource.reload()
  } catch (e: unknown) {
    editState.error.value = resolveApiErrorMessage(e, {
      defaultMessage: t('users.updateFailed'),
      byStatus: {
        400: t('users.validationError'),
        409: t('users.loginOrEmailExists'),
      },
      byCode: {
        LOGIN_OR_EMAIL_EXISTS: t('users.loginOrEmailExists'),
        USER_NOT_FOUND: t('users.updateFailed'),
        MANAGER_ROLE_FORBIDDEN: t('users.forbidden'),
      },
    })
  } finally {
    editState.loading.value = false
  }
}

function askDelete(row: UserRow) {
  deleteError.value = null
  deletingUser.value = row
  deleteOpen.value = true
}

async function deleteUser() {
  if (!deletingUser.value) return
  deleteLoading.value = true
  deleteError.value = null
  try {
    await api.delete(`/users/${deletingUser.value.id}`)
    deleteOpen.value = false
    deletingUser.value = null
    notify({
      message: t('users.deletedSuccess'),
      color: 'success',
    })
    await usersSource.reload()
  } catch (e: unknown) {
    deleteError.value = resolveApiErrorMessage(e, {
      defaultMessage: t('users.deleteFailed'),
      byStatus: {
        403: t('users.deleteForbidden'),
      },
      byCode: {
        CANNOT_DELETE_SELF: t('users.deleteSelfForbidden'),
        USER_NOT_FOUND: t('users.deleteFailed'),
      },
    })
  } finally {
    deleteLoading.value = false
  }
}

async function refreshUsers() {
  await usersSource.reload()
}

watch(
  () => createState.open.value,
  (open) => {
    if (!open) {
      createSubmitAttempted.value = false
      createState.resetForm()
      createState.error.value = null
      vCreate$.value.$reset()
    }
  },
)

watch(
  () => editState.open.value,
  (open) => {
    if (!open) {
      editingUserId.value = null
      originalEditLogin.value = null
      editSubmitAttempted.value = false
      editState.resetForm()
      editState.error.value = null
      vEdit$.value.$reset()
    }
  },
)

</script>

<template>
  <div>
    <AppPageCard :title="t('users.title')">
      <template #actions>
        <VaButton
          preset="secondary"
          :disabled="busy"
          icon="refresh"
          @click="refreshUsers"
        >
          {{ t('common.refresh') }}
        </VaButton>
        <VaButton color="primary" :disabled="busy" icon="add" @click="openCreate">
          {{ t('users.add') }}
        </VaButton>
      </template>

      <template #filters>
        <AppFilterBar
          :has-active-filters="hasToolbarReset"
          :reset-label="t('common.reset')"
          @reset="resetToolbar"
        >
          <VaInput
            :model-value="search"
            :placeholder="t('users.searchPlaceholder')"
            class="toolbar-search"
            @update:model-value="(v) => (search = typeof v === 'string' ? v : '')"
            @keyup.enter="applySearchNow"
          />
          <VaSelect
            :model-value="filters.role"
            :options="roleFilterOptions"
            value-by="value"
            text-by="text"
            class="toolbar-select"
            :placeholder="t('users.filterRole')"
            @update:model-value="onRoleFilter"
          />
        </AppFilterBar>
      </template>

      <VaAlert v-if="error" color="warning" outline class="users-alert">{{ error }}</VaAlert>

      <AppDataTableShell
        :loading="loading"
        :has-items="hasUsers"
        :show-pager="hasUsers && pageCount > 1"
      >
        <UsersTable
          :items="displayItems"
          :busy="busy"
          :can-delete="canDelete"
          :current-user-id="auth.user?.id ?? null"
          :page="page"
          :page-size="limit"
          :loading="false"
          :sort-by="sortBy"
          :sort-order="sortOrder"
          @edit="openEdit"
          @delete="askDelete"
          @sort-by="onTableSortBy"
          @sort-order="onTableSortOrder"
        />
        <template #empty>
          <AppEmptyState
            icon="group_off"
            :title="t('users.emptyTitle')"
            :description="t('users.emptyDesc')"
            :action-label="t('users.add')"
            action-icon="add"
            @action="openCreate"
          />
        </template>

        <template #skeleton>
          <div class="users-skeleton">
            <VaSkeletonGroup animation="wave">
              <VaSkeleton class="users-skeleton__toolbar" variant="text" :lines="1" />
              <VaSkeleton
                v-for="n in 7"
                :key="n"
                class="users-skeleton__row"
                variant="rounded"
                height="2.65rem"
              />
            </VaSkeletonGroup>
          </div>
        </template>

        <template #pager>
          <AppTablePagerRow
            :limit="limit"
            :page="page"
            :pages="pageCount"
            :disabled="busy"
            @update:limit="(v) => (limit = v)"
            @update:page="(v) => (page = v)"
          />
        </template>
      </AppDataTableShell>
    </AppPageCard>

    <VaModal
      :model-value="createState.open.value"
      hide-default-actions
      no-padding
      max-width="min(92vw, 640px)"
      class="user-editor-modal-shell"
      @update:model-value="onCreateModalUpdate"
    >
      <template #header />
      <form class="user-editor" @submit.prevent="createUser" @keydown="onFormTabKeydown">
        <header class="user-editor__header">
          <div class="user-editor__lead">
            <div class="user-editor__icon" aria-hidden="true">
              <VaIcon name="person_add" size="22px" />
            </div>
            <div class="user-editor__head-copy">
              <h3 class="user-editor__title">{{ t('users.add') }}</h3>
              <p class="user-editor__summary">{{ t('users.formHint') }}</p>
            </div>
          </div>
          <button
            type="button"
            class="user-editor__close"
            :disabled="createState.loading.value"
            :aria-label="t('users.cancel')"
            @click="closeCreateModal"
          >
            <VaIcon name="close" size="22px" />
          </button>
        </header>

        <div class="user-editor__body">
          <UserFormFields
            v-model="createState.form.value"
            :can-assign-role="canAssignRole"
            :password-label="t('users.password')"
            :role-options="roleSelectOptionsCreate"
            :immediate-validation="createFormImmediateValidation"
            :show-field-error="showCreateFieldError"
            :field-error-message="createFieldErrorMessage"
          />
          <VaAlert v-if="createState.error.value" color="danger" outline class="users-alert users-alert--modal">
            {{ createState.error.value }}
          </VaAlert>
        </div>

        <footer class="user-editor__footer">
          <VaButton
            type="button"
            preset="secondary"
            icon="close"
            :disabled="createState.loading.value"
            @click="closeCreateModal"
          >
            {{ t('users.cancel') }}
          </VaButton>
          <VaButton type="submit" :loading="createState.loading.value" icon="check">
            {{ t('users.save') }}
          </VaButton>
        </footer>
      </form>
    </VaModal>

    <VaModal
      :model-value="editState.open.value"
      hide-default-actions
      no-padding
      max-width="min(92vw, 640px)"
      class="user-editor-modal-shell"
      @update:model-value="onEditModalUpdate"
    >
      <template #header />
      <form class="user-editor" @submit.prevent="updateUser" @keydown="onFormTabKeydown">
        <header class="user-editor__header">
          <div class="user-editor__lead">
            <div class="user-editor__icon" aria-hidden="true">
              <VaIcon name="badge" size="22px" />
            </div>
            <div class="user-editor__head-copy">
              <h3 class="user-editor__title">{{ t('users.editTitle') }}</h3>
              <p class="user-editor__summary">
                {{ t('users.editFormHint', { login: originalEditLogin ?? '—' }) }}
              </p>
            </div>
          </div>
          <button
            type="button"
            class="user-editor__close"
            :disabled="editState.loading.value"
            :aria-label="t('users.cancel')"
            @click="closeEditModal"
          >
            <VaIcon name="close" size="22px" />
          </button>
        </header>

        <div class="user-editor__body">
          <UserFormFields
            v-model="editState.form.value"
            :can-assign-role="canAssignRole"
            :password-label="t('users.newPasswordOptional')"
            :password-hint="t('users.passwordSectionHint')"
            :role-options="roleSelectOptionsEdit"
            :immediate-validation="editFormImmediateValidation"
            :show-field-error="showEditFieldError"
            :field-error-message="editFieldErrorMessage"
          />
          <VaAlert v-if="editState.error.value" color="danger" outline class="users-alert users-alert--modal">
            {{ editState.error.value }}
          </VaAlert>
        </div>

        <footer class="user-editor__footer">
          <VaButton
            type="button"
            preset="secondary"
            icon="close"
            :disabled="editState.loading.value"
            @click="closeEditModal"
          >
            {{ t('users.cancel') }}
          </VaButton>
          <VaButton type="submit" :loading="editState.loading.value" icon="save">
            {{ t('users.save') }}
          </VaButton>
        </footer>
      </form>
    </VaModal>

    <ConfirmModal
      v-model="deleteOpen"
      :title="t('users.deleteTitle')"
      :message="t('users.deleteConfirm', { login: deletingUser?.login ?? '' })"
      :confirm-label="t('users.delete')"
      :cancel-label="t('users.cancel')"
      :loading="deleteLoading"
      :error="deleteError"
      danger
      @confirm="deleteUser"
    />
  </div>
</template>

<style scoped>
.users-skeleton {
  border: 1px solid var(--app-border);
  border-radius: var(--app-card-radius);
  padding: 0.8rem;
  background: var(--app-surface);
}

.users-skeleton__toolbar {
  margin-bottom: 0.6rem;
}

.users-skeleton__row + .users-skeleton__row {
  margin-top: 0.45rem;
}

.users-alert {
  width: 100%;
  margin-top: 0.35rem;
}

.users-alert--modal {
  margin-top: 0;
}

.user-editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.user-editor__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.9rem 1rem 0.8rem;
  border-bottom: 1px solid color-mix(in srgb, var(--app-border) 78%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--app-accent) 5%, var(--app-surface)) 0%,
    var(--app-surface) 100%
  );
}

.user-editor__lead {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  min-width: 0;
}

.user-editor__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 12px;
  background: color-mix(in srgb, var(--app-accent) 14%, var(--app-surface));
  color: var(--app-accent);
  flex-shrink: 0;
}

.user-editor__head-copy {
  min-width: 0;
}

.user-editor__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.3;
}

.user-editor__summary {
  margin: 0.22rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--app-muted);
}

.user-editor__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--app-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.user-editor__close:hover:not(:disabled) {
  color: var(--app-text);
  background: color-mix(in srgb, var(--app-surface) 86%, var(--app-border) 14%);
}

.user-editor__close:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--app-accent) 55%, transparent);
  outline-offset: 2px;
}

.user-editor__body {
  display: grid;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  max-height: min(68dvh, 42rem);
  overflow: auto;
}

.user-editor__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.75rem 1rem 0.9rem;
  border-top: 1px solid color-mix(in srgb, var(--app-border) 78%, transparent);
  background: color-mix(in srgb, var(--app-surface) 96%, var(--app-bg-end));
}

.user-editor__footer :deep(.va-button) {
  min-height: var(--app-action-height);
  min-width: 8.5rem;
}

.toolbar-select {
  min-width: 12rem;
}

.toolbar-search {
  --va-input-wrapper-width: 100%;
  flex: 1 1 22rem;
  min-width: 22rem;
  max-width: 42rem;
}

@media (max-width: 860px) {
  .toolbar-search {
    min-width: min(100%, 16rem);
  }

  .toolbar-select {
    min-width: min(100%, 12rem);
  }

  .user-editor__footer {
    flex-direction: column-reverse;
    align-items: stretch;
  }

  .user-editor__footer :deep(.va-button) {
    width: 100%;
    min-width: 0;
  }
}

</style>
