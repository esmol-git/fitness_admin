import './assets/tailwind.css'
import 'vuestic-ui/dist/styles/index.css'
import './assets/main.css'
import './assets/vuestic-overrides.css'
import './assets/material-icons.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import {
  BreakpointConfigPlugin,
  ColorsClassesPlugin,
  VaAlert,
  VaBadge,
  VaButton,
  VaCard,
  VaCardContent,
  VaCardTitle,
  VaCheckbox,
  VaConfig,
  VaCounter,
  VaDataTable,
  VaDatePicker,
  VaDateInput,
  VaDropdownPlugin,
  VaIcon,
  VaInnerLoading,
  VaInput,
  VaModal,
  VaModalPlugin,
  VaNavbar,
  VaPagination,
  VaPopover,
  VaSelect,
  VaSlider,
  VaSkeleton,
  VaSkeletonGroup,
  VaToastPlugin,
  createVuesticEssential,
} from 'vuestic-ui'

import App from '@/App.vue'
import router from '@/router'
import i18n from '@/plugins/i18n'

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

const app = createApp(App)

app.use(pinia)
app.use(
  createVuesticEssential({
    components: {
      VaAlert,
      VaBadge,
      VaButton,
      VaCard,
      VaCardContent,
      VaCardTitle,
      VaCheckbox,
      VaConfig,
      VaCounter,
      VaDataTable,
      VaDatePicker,
      VaDateInput,
      VaIcon,
      VaInnerLoading,
      VaInput,
      VaModal,
      VaNavbar,
      VaPagination,
      VaPopover,
      VaSelect,
      VaSlider,
      VaSkeleton,
      VaSkeletonGroup,
    },
    plugins: {
      BreakpointConfigPlugin,
      ColorsClassesPlugin,
      VaDropdownPlugin,
      VaModalPlugin,
      VaToastPlugin,
    },
  }),
)
app.use(router)
app.use(i18n)

// Иначе первый кадр может быть с «чужим» маршрутом (например /), и мелькает сайдбар до редиректа на login
await router.isReady()
app.mount('#app')
