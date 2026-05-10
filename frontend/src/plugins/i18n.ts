import { createI18n } from 'vue-i18n'
import en from '@/locales/en.json'
import ru from '@/locales/ru.json'

export const LOCALE_MESSAGES = { en, ru }

export default createI18n({
  legacy: false,
  locale: 'ru',
  fallbackLocale: 'en',
  messages: LOCALE_MESSAGES,
})
