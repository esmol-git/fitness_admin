<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  modelValue: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  loading?: boolean
  danger?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm'): void
}>()
const { t } = useI18n()

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <VaModal
    :model-value="props.modelValue"
    max-width="min(92vw, 440px)"
    hide-default-actions
    no-padding
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="confirm-shell" :class="{ 'confirm-shell--danger': props.danger }">
      <header class="confirm-header">
        <div class="confirm-icon" :class="{ 'confirm-icon--danger': props.danger }" aria-hidden="true">
          <VaIcon :name="props.danger ? 'warning' : 'help_outline'" size="20px" />
        </div>
        <div class="confirm-heading">
          <h3 class="confirm-title">{{ props.title }}</h3>
          <p class="confirm-message">{{ props.message }}</p>
        </div>
      </header>

      <section class="confirm-content">
        <div v-if="props.danger" class="confirm-note">
          <VaIcon name="report" size="16px" />
          <span>{{ t('common.irreversibleAction') }}</span>
        </div>
        <VaAlert v-if="props.error" color="danger" outline>{{ props.error }}</VaAlert>
      </section>

      <footer class="confirm-actions">
        <VaButton preset="secondary" :disabled="props.loading" @click="close">
          {{ props.cancelLabel }}
        </VaButton>
        <VaButton
          :color="props.danger ? 'danger' : 'primary'"
          :icon="props.danger ? 'delete_forever' : 'check'"
          :loading="props.loading"
          @click="emit('confirm')"
        >
          {{ props.confirmLabel }}
        </VaButton>
      </footer>
    </div>
  </VaModal>
</template>

<style scoped>
.confirm-shell {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-height: min(85vh, 560px);
  padding: 1.25rem;
  gap: 1rem;
  overflow: auto;
}

.confirm-shell--danger {
  --confirm-accent: var(--va-danger);
}

.confirm-header {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.confirm-icon {
  width: 2.1rem;
  height: 2.1rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--app-accent) 14%, white);
  color: var(--app-accent-strong);
  flex-shrink: 0;
  margin-top: 0.1rem;
}

.confirm-icon--danger {
  background: color-mix(in srgb, var(--va-danger) 14%, white);
  color: var(--va-danger);
}

.confirm-heading {
  min-width: 0;
}

.confirm-title {
  margin: 0;
  font-size: 1.12rem;
  font-weight: 700;
  line-height: 1.25;
  color: var(--app-text);
}

.confirm-message {
  margin: 0.3rem 0 0;
  font-size: 1rem;
  color: var(--app-text);
  line-height: 1.4;
  word-break: break-word;
}

.confirm-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.confirm-note {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  border-radius: 10px;
  background: color-mix(in srgb, var(--va-danger) 9%, var(--app-surface));
  color: color-mix(in srgb, var(--va-danger) 78%, var(--app-text));
  border: 1px solid color-mix(in srgb, var(--va-danger) 28%, var(--app-border));
  padding: 0.6rem 0.7rem;
  font-size: 0.9rem;
  line-height: 1.3;
}

.confirm-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.65rem;
  flex-shrink: 0;
  margin: 0;
  padding-top: 1rem;
  border-top: 1px solid var(--app-border);
}

.confirm-actions :deep(.va-button) {
  min-width: 6.5rem;
}

@media (max-width: 640px) {
  .confirm-shell {
    padding: 1.1rem;
    gap: 0.85rem;
  }

  .confirm-actions {
    flex-direction: column-reverse;
    align-items: stretch;
    padding-top: 0.85rem;
    gap: 0.5rem;
  }

  .confirm-actions :deep(.va-button) {
    width: 100%;
    min-width: 0;
  }
}
</style>
