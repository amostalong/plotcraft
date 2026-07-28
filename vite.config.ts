import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const host = process.env.TAURI_DEV_HOST

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 14201,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 14202 }
      : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
