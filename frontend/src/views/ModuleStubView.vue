<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'

const props = defineProps<{
  titleKey: string
  icon?: string
}>()

const { t } = useI18n()
</script>

<template>
  <AppPageCard :title="t(props.titleKey)">
    <AppEmptyState
      :icon="props.icon ?? 'construction'"
      :title="t('modules.stubTitle')"
      :description="t('modules.stubDesc')"
    />
  </AppPageCard>
</template>
