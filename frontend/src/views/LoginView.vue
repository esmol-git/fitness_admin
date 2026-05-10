<script setup lang="ts">
import axios from 'axios'
import { computed, reactive, ref, unref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import useVuelidate from '@vuelidate/core'
import { helpers, minLength, required } from '@vuelidate/validators'
import { useAuthStore } from '@/stores/auth'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const sessionExpired = ref(false)
watch(
  () => route.query.session,
  (v) => {
    if (v !== 'expired') return
    sessionExpired.value = true
    void router.replace({ name: 'login' })
  },
  { immediate: true },
)

const loginRegex = /^[a-zA-Z0-9._-]+$/

const form = reactive({
  login: 'admin',
  password: '',
})

const serverError = ref<string | null>(null)
const loading = ref(false)
const showPassword = ref(false)
const submitAttempted = ref(false)

const rules = computed(() => ({
  login: {
    required: helpers.withMessage(() => t('auth.validation.loginRequired'), required),
    format: helpers.withMessage(
      () => t('auth.validation.loginInvalid'),
      (value: unknown) => {
        const s = String(value ?? '').trim()
        return s.length >= 3 && s.length <= 64 && loginRegex.test(s)
      },
    ),
  },
  password: {
    required: helpers.withMessage(() => t('auth.validation.passwordRequired'), required),
    minLength: helpers.withMessage(() => t('auth.validation.passwordMin'), minLength(8)),
  },
}))

const v$ = useVuelidate(rules, form, { $autoDirty: true })

const canSubmit = computed(
  () => !loading.value && (!submitAttempted.value || !v$.value.$invalid),
)

function showFieldError(field: 'login' | 'password') {
  const node = v$.value[field]
  if (!node) return false
  if (submitAttempted.value) return node.$invalid
  return node.$dirty && node.$error
}

function fieldErrorMessage(field: 'login' | 'password') {
  const node = v$.value[field]
  if (!node) return ''
  const show = submitAttempted.value ? node.$invalid : node.$dirty && node.$error
  if (!show) return ''
  const first = node.$errors[0] ?? node.$silentErrors[0]
  if (!first?.$message) return ''
  return String(unref(first.$message))
}

function onFieldChange() {
  serverError.value = null
}

async function onSubmit() {
  if (loading.value) return
  submitAttempted.value = true
  serverError.value = null

  const ok = await v$.value.$validate()
  if (!ok) {
    return
  }

  loading.value = true
  try {
    await auth.login(form.login.trim(), form.password)
    await router.push({ name: 'home' })
  } catch (e: unknown) {
    serverError.value = resolveApiErrorMessage(e, {
      defaultMessage: t('auth.invalidCredentials'),
      byStatus: {
        400: t('auth.validationError'),
      },
      byCode: {
        INVALID_CREDENTIALS: t('auth.invalidCredentials'),
      },
    })
    if (axios.isAxiosError(e) && !e.response) {
      serverError.value = t('auth.networkError')
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <VaCard class="login-card rounded-2xl" :gradient="false">
      <VaCardTitle class="login-title">{{ t('auth.title') }}</VaCardTitle>

      <VaCardContent>
        <VaAlert v-if="sessionExpired" color="warning" class="mb-3" border="left" outline>
          {{ t('auth.sessionExpired') }}
        </VaAlert>
        <form class="form" @submit.prevent="onSubmit">
          <VaInput
            v-model="form.login"
            :label="t('auth.login')"
            autocomplete="username"
            class="field"
            size="large"
            :immediate-validation="submitAttempted"
            :error="showFieldError('login')"
            :error-messages="fieldErrorMessage('login') ? [fieldErrorMessage('login')] : []"
            @update:model-value="onFieldChange"
          />
          <VaInput
            v-model="form.password"
            :label="t('auth.password')"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            class="field"
            size="large"
            :immediate-validation="submitAttempted"
            :error="showFieldError('password')"
            :error-messages="fieldErrorMessage('password') ? [fieldErrorMessage('password')] : []"
            @update:model-value="onFieldChange"
          >
            <template #appendInner>
              <VaButton
                type="button"
                preset="plain"
                size="small"
                :icon="showPassword ? 'visibility_off' : 'visibility'"
                :aria-label="showPassword ? t('auth.hidePassword') : t('auth.showPassword')"
                @click="showPassword = !showPassword"
              />
            </template>
          </VaInput>
          <VaAlert v-if="serverError" color="danger" class="mt-2" border="left">
            {{ serverError }}
          </VaAlert>
          <VaButton
            type="submit"
            class="login-submit"
            color="primary"
            :loading="loading"
            :disabled="!canSubmit || loading"
            block
          >
            {{ t('auth.submit') }}
          </VaButton>
        </form>

        <p class="hint">{{ t('auth.seedHint') }}</p>
      </VaCardContent>
    </VaCard>
  </div>
</template>

<style scoped>
.login-page {
  width: 100%;
  max-width: 460px;
  margin: 0 auto;
  padding: 1rem;
}

.login-card {
  background: var(--app-surface) !important;
  border: none !important;
  border-radius: var(--app-card-radius);
  box-shadow: var(--app-shadow-card);
}

.login-title {
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-align: center;
  justify-content: center;
  padding-bottom: 0.5rem;
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--app-page-gap);
}

.field {
  --va-background-element: var(--app-surface);
}

.field :deep(.va-input-wrapper__field) {
  min-height: var(--app-control-height-lg) !important;
}

.field :deep(.va-input-wrapper__container) {
  min-height: var(--app-control-height-lg) !important;
  align-items: center;
}

.login-submit {
  margin-top: 0.25rem;
  min-height: var(--app-control-height-lg);
}

.hint {
  font-size: 0.8rem;
  color: var(--app-muted);
  margin-top: 1.25rem;
  line-height: 1.45;
}

.mt-2 {
  margin-top: 0.5rem;
}
</style>
