import { ref } from 'vue'

export function useCrudForm<T>(createInitial: () => T) {
  const open = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const form = ref<T>(createInitial())

  function resetForm() {
    form.value = createInitial()
  }

  function openForm(next?: T) {
    error.value = null
    form.value = next ?? createInitial()
    open.value = true
  }

  function closeForm() {
    open.value = false
  }

  return {
    open,
    loading,
    error,
    form,
    resetForm,
    openForm,
    closeForm,
  }
}
