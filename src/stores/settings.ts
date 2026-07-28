// settings pinia store —— config 状态

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { loadConfig, saveConfig, DEFAULT_CONFIG, type Config } from '@/lib/settings'

export const useSettingsStore = defineStore('settings', () => {
  const config = ref<Config>({ ...DEFAULT_CONFIG })
  const loaded = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  async function init() {
    if (loaded.value) return
    try {
      config.value = await loadConfig()
      loaded.value = true
    } catch (e) {
      error.value = String(e)
      // fallback: 用 default
      config.value = { ...DEFAULT_CONFIG }
    }
  }

  async function save() {
    saving.value = true
    error.value = null
    try {
      await saveConfig(config.value)
    } catch (e) {
      error.value = String(e)
      throw e
    } finally {
      saving.value = false
    }
  }

  function reset() {
    config.value = { ...DEFAULT_CONFIG }
  }

  return { config, loaded, saving, error, init, save, reset }
})
