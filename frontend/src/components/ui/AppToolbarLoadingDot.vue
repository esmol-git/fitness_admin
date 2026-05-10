<template>
  <div class="app-toolbar-loading-dot" aria-live="polite" />
</template>

<style scoped>
.app-toolbar-loading-dot {
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 999px;
  border: 2px solid color-mix(in srgb, var(--app-border) 85%, transparent);
  border-top-color: var(--app-accent);
  animation: app-toolbar-spin 0.8s linear infinite;
}

@keyframes app-toolbar-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
