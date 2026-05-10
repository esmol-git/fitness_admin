import { computed } from 'vue'
import { helpers, maxLength, minLength, required } from '@vuelidate/validators'
import { USER_ROLE_OPTIONS } from '@/config/usersTable'
import type { UserForm, UserRole } from '@/types/users'

/** Роли из прежней модели — только для режима редактирования, пока запись не переведена на ADMIN/MANAGER. */
const LEGACY_USER_ROLES: readonly UserRole[] = ['TRAINER', 'RECEPTIONIST', 'TRAINEE']

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const loginRegex = /^[a-zA-Z0-9._-]+$/
/** Маска +7 (000) 000-00-00 — 11 цифр, начинается с 7 (как у клиента). */
function phoneRuValid(value: unknown): boolean {
  const s = String(value ?? '').trim()
  if (!s) return true
  const d = s.replace(/\D/g, '')
  return d.length === 11 && d.startsWith('7')
}

type Translate = (key: string) => string

type UserFormRuleOptions = {
  /**
   * Allow legacy login values (e.g. email in login) only for edit mode
   * and only when caller explicitly decides the value is acceptable as-is.
   */
  allowLegacyLogin?: (value: string) => boolean
}

export function useUserFormVuelidateRules(
  t: Translate,
  mode: 'create' | 'edit',
  options: UserFormRuleOptions = {},
) {
  return computed(() => ({
    firstName: {
      required: helpers.withMessage(() => t('users.validation.firstNameRequired'), required),
      trimmed: helpers.withMessage(
        () => t('users.validation.firstNameRequired'),
        (value: unknown) => String(value ?? '').trim().length >= 1,
      ),
      maxLength: helpers.withMessage(() => t('users.validation.firstNameMax'), maxLength(120)),
    },
    lastName: {
      required: helpers.withMessage(() => t('users.validation.lastNameRequired'), required),
      trimmed: helpers.withMessage(
        () => t('users.validation.lastNameRequired'),
        (value: unknown) => String(value ?? '').trim().length >= 1,
      ),
      maxLength: helpers.withMessage(() => t('users.validation.lastNameMax'), maxLength(120)),
    },
    birthDate: {
      birthFmt: helpers.withMessage(
        () => t('users.validation.birthDateInvalid'),
        (value: unknown) => {
          const s = String(value ?? '').trim()
          if (!s) return true
          if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
          const d = new Date(`${s}T12:00:00.000Z`)
          if (Number.isNaN(d.getTime())) return false
          return d.getTime() <= Date.now()
        },
      ),
    },
    login: {
      required: helpers.withMessage(() => t('users.validation.loginRequired'), required),
      format: helpers.withMessage(
        () => t('users.validation.loginInvalid'),
        (value: unknown) => {
          const s = String(value ?? '').trim()
          if (s.length < 3 || s.length > 64) return false
          if (loginRegex.test(s)) return true
          if (mode === 'edit' && options.allowLegacyLogin?.(s)) return true
          return false
        },
      ),
    },
    email: {
      optionalEmail: helpers.withMessage(
        () => t('users.validation.emailInvalid'),
        (value: unknown) => {
          const s = String(value ?? '').trim()
          return !s || emailRegex.test(s)
        },
      ),
    },
    password:
      mode === 'create'
        ? {
            required: helpers.withMessage(() => t('users.validation.passwordRequired'), required),
            minLength: helpers.withMessage(() => t('users.validation.passwordMin'), minLength(8)),
          }
        : {
            minIfSet: helpers.withMessage(
              () => t('users.validation.passwordMin'),
              (value: unknown) => {
                const s = String(value ?? '')
                return s.length === 0 || s.length >= 8
              },
            ),
          },
    role: {
      validRole: helpers.withMessage(
        () => t('users.validation.roleRequired'),
        (value: unknown) => {
          const v = value as UserRole
          if ((USER_ROLE_OPTIONS as readonly string[]).includes(v)) return true
          return mode === 'edit' && LEGACY_USER_ROLES.includes(v)
        },
      ),
    },
    phone: {
      phoneFmt: helpers.withMessage(
        () => t('users.validation.phoneInvalid'),
        (value: unknown) => phoneRuValid(value),
      ),
    },
  }))
}
