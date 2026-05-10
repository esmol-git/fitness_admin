import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [tailwindcss(), vue(), command === 'serve' ? vueDevTools() : null].filter(
    Boolean,
  ),
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('vuestic-ui')) return 'vendor-vuestic'
          if (id.includes('vue-i18n')) return 'vendor-i18n'
          if (id.includes('pinia')) return 'vendor-pinia'
          if (id.includes('vue-router')) return 'vendor-router'
          if (id.includes('axios')) return 'vendor-http'
          if (id.includes('/vue/')) return 'vendor-vue'
          return 'vendor'
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
}))
