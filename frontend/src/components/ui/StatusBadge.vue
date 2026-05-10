<script setup lang="ts">
const props = defineProps<{
  label: string
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
}>()
</script>

<template>
  <span class="status-badge" :class="`status-badge--${props.tone || 'neutral'}`">
    {{ props.label }}
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  padding: 0.28rem 0.72rem;
  min-height: 1.65rem;
  font-size: 0.74rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  line-height: 1.15;
  white-space: nowrap;
  border: 1px solid transparent;
  box-shadow:
    0 1px 2px color-mix(in srgb, var(--app-text) 6%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 14%, transparent);
  transition:
    box-shadow 0.18s ease,
    transform 0.12s ease,
    border-color 0.15s ease;
}

.status-badge--success {
  color: #047857;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, #34d399 18%, white 82%) 0%,
    color-mix(in srgb, #6ee7b7 12%, white 88%) 100%
  );
  border-color: color-mix(in srgb, #10b981 32%, transparent);
  box-shadow:
    0 1px 2px color-mix(in srgb, #065f46 12%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 55%, transparent);
}

.status-badge--warning {
  color: #92400e;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, #fbbf24 22%, white 78%) 0%,
    color-mix(in srgb, #fcd34d 14%, white 86%) 100%
  );
  border-color: color-mix(in srgb, #d97706 28%, transparent);
  box-shadow:
    0 1px 2px color-mix(in srgb, #78350f 10%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 50%, transparent);
}

.status-badge--danger {
  color: #991b1b;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, #f87171 16%, white 84%) 0%,
    color-mix(in srgb, #fecaca 12%, white 88%) 100%
  );
  border-color: color-mix(in srgb, #ef4444 30%, transparent);
  box-shadow:
    0 1px 2px color-mix(in srgb, #7f1d1d 10%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 48%, transparent);
}

.status-badge--info {
  color: #1e3a8a;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, #60a5fa 16%, white 84%) 0%,
    color-mix(in srgb, #bfdbfe 10%, white 90%) 100%
  );
  border-color: color-mix(in srgb, #3b82f6 28%, transparent);
  box-shadow:
    0 1px 2px color-mix(in srgb, #1e3a8a 8%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 52%, transparent);
}

.status-badge--neutral {
  color: color-mix(in srgb, var(--app-text) 72%, var(--app-muted));
  background: color-mix(in srgb, var(--app-surface) 88%, var(--app-border) 12%);
  border-color: color-mix(in srgb, var(--app-border) 85%, transparent);
  box-shadow:
    0 1px 2px color-mix(in srgb, var(--app-text) 5%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 10%, transparent);
}

:global(:root[data-theme='dark']) .status-badge {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
}

:global(:root[data-theme='dark']) .status-badge--success {
  color: #bbf7d0;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, #059669 42%, var(--app-surface)) 0%,
    color-mix(in srgb, #047857 28%, var(--app-surface)) 100%
  );
  border-color: color-mix(in srgb, #34d399 38%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, #10b981 22%, transparent),
    0 2px 10px color-mix(in srgb, #10b981 18%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 12%, transparent);
}

:global(:root[data-theme='dark']) .status-badge--warning {
  color: #fde68a;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, #b45309 45%, var(--app-surface)) 0%,
    color-mix(in srgb, #92400e 35%, var(--app-surface)) 100%
  );
  border-color: color-mix(in srgb, #fbbf24 35%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, #f59e0b 18%, transparent),
    0 2px 10px color-mix(in srgb, #d97706 12%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
}

:global(:root[data-theme='dark']) .status-badge--danger {
  color: #fecaca;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, #b91c1c 48%, var(--app-surface)) 0%,
    color-mix(in srgb, #991b1b 38%, var(--app-surface)) 100%
  );
  border-color: color-mix(in srgb, #f87171 32%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, #ef4444 20%, transparent),
    0 2px 10px color-mix(in srgb, #ef4444 10%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
}

:global(:root[data-theme='dark']) .status-badge--info {
  color: #bfdbfe;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, #1d4ed8 42%, var(--app-surface)) 0%,
    color-mix(in srgb, #1e40af 36%, var(--app-surface)) 100%
  );
  border-color: color-mix(in srgb, #60a5fa 35%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, #3b82f6 22%, transparent),
    0 2px 10px color-mix(in srgb, #2563eb 12%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
}

:global(:root[data-theme='dark']) .status-badge--neutral {
  color: color-mix(in srgb, var(--app-text) 78%, var(--app-muted));
  background: color-mix(in srgb, var(--app-surface) 55%, var(--app-border) 45%);
  border-color: color-mix(in srgb, var(--app-border) 92%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--app-text) 6%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 5%, transparent);
}
</style>
