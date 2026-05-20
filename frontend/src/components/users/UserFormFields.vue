<script setup lang="ts">
import IMask, { type InputMask } from 'imask'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComponentPublicInstance,
} from 'vue'
import { useI18n } from 'vue-i18n'
import type { UserForm, UserRole } from '@/types/users'
import {
  buildMonthNames,
  buildWeekdayNames,
  formatIsoDate,
  hasDateFormatError,
  normalizeDateInputText,
  ruDateTextToIso,
  toDateValue,
  toRuDateText,
} from '@/utils/ruDateInput'

const props = withDefaults(
  defineProps<{
    modelValue: UserForm
    canAssignRole: boolean
    roleOptions: readonly { text: string; value: UserRole }[]
    passwordLabel: string
    showFieldError: (field: keyof UserForm) => boolean
    fieldErrorMessage: (field: keyof UserForm) => string
    immediateValidation?: boolean
    /** Подсказка под блоком пароля (редактирование — необязательный пароль). */
    passwordHint?: string
  }>(),
  { immediateValidation: false, passwordHint: '' },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: UserForm): void
}>()

const { t, locale } = useI18n()

function patch<K extends keyof UserForm>(key: K, value: UserForm[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

const phoneFieldRef = ref<ComponentPublicInstance | HTMLElement | null>(null)
const birthTextFieldRef = ref<ComponentPublicInstance | HTMLElement | null>(null)
const birthFieldWrapRef = ref<HTMLElement | null>(null)

let phoneMask: InputMask<{ mask: string }> | null = null
let birthMask: InputMask<{ mask: string }> | null = null

const birthTextValue = ref('')
const birthPickerOpen = ref(false)
const birthDateFormatError = ref(false)

const showPassword = ref(false)
const showPasswordConfirm = ref(false)

const birthPickerMonthNames = computed(() =>
  buildMonthNames(locale.value === 'ru' ? 'ru-RU' : 'en-US'),
)
const birthPickerWeekdayNames = computed(() =>
  buildWeekdayNames(locale.value === 'ru' ? 'ru-RU' : 'en-US'),
)

const birthInputError = computed(
  () => props.showFieldError('birthDate') || birthDateFormatError.value,
)
const birthInputErrorMessages = computed(() => {
  if (props.showFieldError('birthDate') && props.fieldErrorMessage('birthDate')) {
    return [props.fieldErrorMessage('birthDate')]
  }
  if (birthDateFormatError.value) return [t('users.invalidBirthFormat')]
  return []
})

function mountPhoneMask() {
  if (phoneMask || !phoneFieldRef.value) return
  const root =
    '$el' in phoneFieldRef.value
      ? (phoneFieldRef.value.$el as HTMLElement)
      : (phoneFieldRef.value as HTMLElement)
  const input = root.querySelector('input') as HTMLInputElement | null
  if (!input) return
  phoneMask = IMask(input, {
    mask: '+{7} (000) 000-00-00',
    lazy: true,
  })
  phoneMask.on('accept', () => {
    if (!phoneMask) return
    const normalized = phoneMask.unmaskedValue.length <= 1 ? '' : phoneMask.value
    if (normalized !== props.modelValue.phone) patch('phone', normalized)
  })
  phoneMask.value = props.modelValue.phone || ''
}

function unmountPhoneMask() {
  if (!phoneMask) return
  phoneMask.destroy()
  phoneMask = null
}

function mountBirthMask() {
  if (birthMask || !birthTextFieldRef.value) return
  const root =
    '$el' in birthTextFieldRef.value
      ? (birthTextFieldRef.value.$el as HTMLElement)
      : (birthTextFieldRef.value as HTMLElement)
  const input = root.querySelector('input') as HTMLInputElement | null
  if (!input) return
  birthMask = IMask(input, {
    mask: '00.00.0000',
    lazy: true,
    overwrite: true,
  })
  birthMask.on('accept', () => {
    if (!birthMask) return
    birthTextValue.value = birthMask.value
    birthDateFormatError.value = hasDateFormatError(birthMask.value)
    const digits = birthMask.unmaskedValue
    if (digits.length === 0) {
      if (props.modelValue.birthDate) patch('birthDate', '')
      return
    }
    if (digits.length < 8) return
    const iso = ruDateTextToIso(birthMask.value)
    if (iso && iso !== props.modelValue.birthDate) patch('birthDate', iso)
  })
  const initial = toRuDateText(props.modelValue.birthDate)
  birthTextValue.value = initial
  birthMask.value = initial
}

function unmountBirthMask() {
  if (!birthMask) return
  birthMask.destroy()
  birthMask = null
}

function onBirthTextInput(value: string) {
  const normalized = value.replace(/[^\d.]/g, '').slice(0, 10)
  birthTextValue.value = normalized
  birthDateFormatError.value = normalized.length > 0 && !ruDateTextToIso(normalized)
  if (birthMask && birthMask.value !== normalized) birthMask.value = normalized
}

function onBirthTextBlur() {
  const { text, iso, valid } = normalizeDateInputText(birthTextValue.value)
  birthTextValue.value = text
  if (birthMask && birthMask.value !== text) birthMask.value = text
  birthDateFormatError.value = !valid
  patch('birthDate', valid ? iso : '')
}

function onBirthDatePickerSelect(value: unknown) {
  if (!(value instanceof Date)) {
    patch('birthDate', '')
    birthTextValue.value = ''
    if (birthMask) birthMask.value = ''
    birthDateFormatError.value = false
    birthPickerOpen.value = false
    return
  }
  patch('birthDate', formatIsoDate(value))
  birthDateFormatError.value = false
  const next = toRuDateText(formatIsoDate(value))
  birthTextValue.value = next
  if (birthMask) birthMask.value = next
  birthPickerOpen.value = false
}

function clearBirthDate() {
  birthTextValue.value = ''
  birthDateFormatError.value = false
  patch('birthDate', '')
  if (birthMask) birthMask.value = ''
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (!target) return
  if (birthPickerOpen.value && birthFieldWrapRef.value && !birthFieldWrapRef.value.contains(target)) {
    birthPickerOpen.value = false
  }
}

watch(
  () => props.modelValue.phone,
  (next) => {
    if (!phoneMask) return
    if (phoneMask.value !== next) phoneMask.value = next || ''
  },
)

watch(
  () => props.modelValue.birthDate,
  (iso) => {
    const next = toRuDateText(iso || '')
    if (next !== birthTextValue.value) birthTextValue.value = next
    if (birthMask && birthMask.value !== next) birthMask.value = next
    if (!iso) birthDateFormatError.value = false
  },
)

onMounted(async () => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  await nextTick()
  birthTextValue.value = toRuDateText(props.modelValue.birthDate)
  mountPhoneMask()
  mountBirthMask()
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  unmountPhoneMask()
  unmountBirthMask()
})
</script>

<template>
  <div class="user-form">
    <section class="user-form-card">
      <header class="user-form-card__head">
        <span class="user-form-card__label">{{ $t('users.sections.personal') }}</span>
      </header>
      <div class="user-form-card__grid user-form-card__grid--2">
        <VaInput
          :model-value="modelValue.firstName"
          :label="$t('users.firstName')"
          :immediate-validation="props.immediateValidation"
          :error="props.showFieldError('firstName')"
          :error-messages="props.fieldErrorMessage('firstName') ? [props.fieldErrorMessage('firstName')] : []"
          @update:model-value="patch('firstName', $event)"
        />
        <VaInput
          :model-value="modelValue.lastName"
          :label="$t('users.lastName')"
          :immediate-validation="props.immediateValidation"
          :error="props.showFieldError('lastName')"
          :error-messages="props.fieldErrorMessage('lastName') ? [props.fieldErrorMessage('lastName')] : []"
          @update:model-value="patch('lastName', $event)"
        />
      </div>
      <div class="user-form-card__grid user-form-card__grid--2">
        <div ref="birthFieldWrapRef" class="custom-date-field">
          <VaInput
            ref="birthTextFieldRef"
            :model-value="birthTextValue"
            :label="$t('users.birthDate')"
            :placeholder="$t('users.birthDatePlaceholder')"
            inputmode="numeric"
            :class="{ 'date-input--invalid': birthInputError }"
            :error="birthInputError"
            :error-messages="birthInputErrorMessages"
            @focus="mountBirthMask"
            @update:model-value="onBirthTextInput(typeof $event === 'string' ? $event : String($event ?? ''))"
            @blur="onBirthTextBlur"
          >
            <template #appendInner>
              <VaButton
                v-if="birthTextValue"
                type="button"
                preset="plain"
                icon="close"
                size="small"
                class="date-clear-btn"
                @click.stop="clearBirthDate"
              />
              <VaButton
                type="button"
                preset="plain"
                icon="date_range"
                size="medium"
                class="date-trigger-btn"
                @click.stop="birthPickerOpen = !birthPickerOpen"
              />
            </template>
          </VaInput>
          <div v-if="birthPickerOpen" class="date-picker-popup">
            <VaDatePicker
              :model-value="toDateValue(modelValue.birthDate)"
              :month-names="birthPickerMonthNames"
              :weekday-names="birthPickerWeekdayNames"
              first-weekday="monday"
              @update:model-value="onBirthDatePickerSelect"
            />
          </div>
        </div>
        <VaInput
          ref="phoneFieldRef"
          :model-value="modelValue.phone"
          :label="$t('users.phone')"
          :placeholder="$t('clients.phonePlaceholder')"
          :immediate-validation="props.immediateValidation"
          :error="props.showFieldError('phone')"
          :error-messages="props.fieldErrorMessage('phone') ? [props.fieldErrorMessage('phone')] : []"
          @update:model-value="patch('phone', $event)"
        />
      </div>
    </section>

    <section class="user-form-card">
      <header class="user-form-card__head">
        <span class="user-form-card__label">{{ $t('users.sections.account') }}</span>
      </header>
      <div class="user-form-card__grid user-form-card__grid--2">
        <VaInput
          :model-value="modelValue.login"
          :label="$t('users.login')"
          autocomplete="username"
          :immediate-validation="props.immediateValidation"
          :error="props.showFieldError('login')"
          :error-messages="props.fieldErrorMessage('login') ? [props.fieldErrorMessage('login')] : []"
          @update:model-value="patch('login', $event)"
        />
        <VaInput
          :model-value="modelValue.email"
          :label="$t('users.email')"
          type="email"
          autocomplete="email"
          :immediate-validation="props.immediateValidation"
          :error="props.showFieldError('email')"
          :error-messages="props.fieldErrorMessage('email') ? [props.fieldErrorMessage('email')] : []"
          @update:model-value="patch('email', $event)"
        />
      </div>
      <VaSelect
        v-if="canAssignRole"
        :model-value="modelValue.role"
        :label="$t('users.role')"
        :options="[...roleOptions]"
        text-by="text"
        value-by="value"
        :immediate-validation="props.immediateValidation"
        :error="props.showFieldError('role')"
        :error-messages="props.fieldErrorMessage('role') ? [props.fieldErrorMessage('role')] : []"
        @update:model-value="patch('role', $event)"
      />
      <p v-if="passwordHint" class="user-form-card__hint">{{ passwordHint }}</p>
      <div class="user-form-card__grid user-form-card__grid--2">
        <VaInput
          class="user-form-password"
          :model-value="modelValue.password"
          :label="passwordLabel"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="new-password"
          :immediate-validation="props.immediateValidation"
          :error="props.showFieldError('password')"
          :error-messages="props.fieldErrorMessage('password') ? [props.fieldErrorMessage('password')] : []"
          @update:model-value="patch('password', $event)"
        >
          <template #appendInner>
            <VaButton
              type="button"
              preset="plain"
              size="small"
              class="user-form-password__toggle"
              :icon="showPassword ? 'visibility_off' : 'visibility'"
              :title="showPassword ? $t('users.hidePassword') : $t('users.showPassword')"
              :aria-label="showPassword ? $t('users.hidePassword') : $t('users.showPassword')"
              @click.stop="showPassword = !showPassword"
            />
          </template>
        </VaInput>
        <VaInput
          class="user-form-password"
          :model-value="modelValue.passwordConfirm"
          :label="$t('users.passwordConfirm')"
          :type="showPasswordConfirm ? 'text' : 'password'"
          autocomplete="new-password"
          :immediate-validation="props.immediateValidation"
          :error="props.showFieldError('passwordConfirm')"
          :error-messages="
            props.fieldErrorMessage('passwordConfirm') ? [props.fieldErrorMessage('passwordConfirm')] : []
          "
          @update:model-value="patch('passwordConfirm', $event)"
        >
          <template #appendInner>
            <VaButton
              type="button"
              preset="plain"
              size="small"
              class="user-form-password__toggle"
              :icon="showPasswordConfirm ? 'visibility_off' : 'visibility'"
              :title="showPasswordConfirm ? $t('users.hidePassword') : $t('users.showPassword')"
              :aria-label="showPasswordConfirm ? $t('users.hidePassword') : $t('users.showPassword')"
              @click.stop="showPasswordConfirm = !showPasswordConfirm"
            />
          </template>
        </VaInput>
      </div>
    </section>
  </div>
</template>

<style scoped>
.user-form {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.user-form-card {
  display: grid;
  gap: 0.7rem;
  padding: 0.8rem 0.85rem;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--app-border) 84%, transparent);
  background: color-mix(in srgb, var(--app-surface) 98%, white 2%);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--app-text) 4%, transparent);
}

.user-form-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.user-form-card__label {
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--app-muted);
}

.user-form-card__hint {
  margin: -0.15rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--app-muted);
}

.user-form-card__grid {
  display: grid;
  gap: 0.75rem;
}

.user-form-card__grid--2 {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.user-form-card :deep(.va-input-wrapper),
.user-form-card :deep(.va-select),
.user-form-card :deep(.va-date-input) {
  min-width: 0;
  max-width: 100%;
}

.user-form-card :deep(.va-input-wrapper__container),
.user-form-card :deep(.va-input-wrapper__field),
.user-form-card :deep(.va-select__anchor) {
  min-height: 2.85rem;
}

.user-form-card :deep(.va-input-wrapper__messages) {
  min-height: 1.2rem;
  margin-top: 0.2rem;
}

.user-form-card :deep(.va-message-list__list) {
  min-height: 1.2rem;
}

.user-form-card :deep(.va-input-wrapper--error .va-input-wrapper__field),
.user-form-card :deep(.va-input-wrapper--error.va-input-wrapper--focused .va-input-wrapper__field) {
  border-color: var(--va-danger) !important;
  box-shadow: inset 0 0 0 1px var(--va-danger) !important;
}

.user-form-password__toggle {
  flex-shrink: 0;
  margin: 0 -0.15rem 0 0;
}

.custom-date-field {
  position: relative;
}

.custom-date-field :deep(.va-input-wrapper) {
  width: 100%;
}

.custom-date-field :deep(.date-input--invalid .va-input-wrapper__field),
.custom-date-field :deep(.date-input--invalid .va-input-wrapper--focused .va-input-wrapper__field) {
  border-color: var(--va-danger) !important;
  box-shadow: inset 0 0 0 1px var(--va-danger) !important;
}

.date-picker-popup {
  position: absolute;
  z-index: 40;
  top: calc(100% + 0.25rem);
  left: 50%;
  transform: translateX(-50%);
  min-width: 18rem;
  max-width: min(20rem, calc(100vw - 2rem));
  border: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
  box-shadow: var(--app-shadow-soft);
  background: var(--app-surface);
  border-radius: 10px;
  overflow: hidden;
}

@media (max-width: 520px) {
  .user-form-card__grid--2 {
    grid-template-columns: 1fr;
  }
}
</style>
