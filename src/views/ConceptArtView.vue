<script setup lang="ts">
// ConceptArtView —— 设定图 tab（v0.2+ 实装：图库 + prompt 管理 + 占位图）
//
// - 3 个固定 category section（人物 / 场景 / 物品），各带 card grid + "新建"
// - 有图（玩家自放 png/jpg 到 art/）→ card 显示图；无图 → 占位 tile
// - 点 card → 编辑 modal：prompt textarea 自动落盘（800ms debounce，对齐 settings 惯例）
// - 删除走二次确认（对齐 session 删除 confirm-pulse 模式）
// - v0.3+ 路线：真图片生成 / AI 帮写 prompt（本期不做）

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { FolderOpen, ImageIcon, Plus, RefreshCw, Trash2, X } from 'lucide-vue-next'

import { ART_CATEGORIES, ART_CATEGORY_LABELS, type ArtCategory, type ArtEntry } from '@/lib/art'
import { useArtStore } from '@/stores/art'
import { useProjectStore } from '@/stores/project'

const art = useArtStore()
const project = useProjectStore()

/** 已解析的图片 data URL（`${category}/${name}` → url），配合 store 的 imageCache */
const imageUrls = ref<Record<string, string>>({})

function entryKey(entry: Pick<ArtEntry, 'category' | 'name'>): string {
  return `${entry.category}/${entry.name}`
}

/** entries 变化后懒拉有图 entry 的 data URL */
watch(
  () => art.entries,
  (list) => {
    const next: Record<string, string> = {}
    for (const e of list) {
      const key = entryKey(e)
      if (!e.has_image) continue
      const cached = imageUrls.value[key]
      if (cached) {
        next[key] = cached
      } else {
        void art.imageUrl(e).then((url) => {
          if (url) imageUrls.value = { ...imageUrls.value, [key]: url }
        })
      }
    }
    imageUrls.value = next
  },
  { immediate: true },
)

function entriesOf(category: ArtCategory): ArtEntry[] {
  return art.entries.filter((e) => e.category === category)
}

const hasAnyEntry = computed(() => art.entries.length > 0)

// === 新建 entry modal ===
const createCategory = ref<ArtCategory | null>(null)
const createName = ref('')
const creating = ref(false)
const createError = ref<string | null>(null)

function onNew(category: ArtCategory) {
  createCategory.value = category
  createName.value = ''
  createError.value = null
}
function onCreateModalClose() {
  if (creating.value) return
  createCategory.value = null
}
async function onCreateConfirm() {
  const category = createCategory.value
  const name = createName.value.trim()
  if (!category || !name) return
  creating.value = true
  createError.value = null
  try {
    await art.create(category, name)
    createCategory.value = null
  } catch (e) {
    createError.value = e instanceof Error ? e.message : String(e)
  } finally {
    creating.value = false
  }
}

// === 编辑 modal（prompt 自动落盘） ===
const editing = ref<ArtEntry | null>(null)
const promptDraft = ref('')
const promptOriginal = ref('')
const saving = ref(false)
const savedAt = ref<string | null>(null)
const saveError = ref<string | null>(null)
const confirmingDelete = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null

function onOpenEntry(entry: ArtEntry) {
  flushSave()
  editing.value = entry
  promptDraft.value = entry.prompt
  promptOriginal.value = entry.prompt
  savedAt.value = entry.updated_at ? shortTime(entry.updated_at) : null
  saveError.value = null
  confirmingDelete.value = false
}

watch(promptDraft, (v) => {
  if (!editing.value || v === promptOriginal.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void savePromptNow(), 800)
})

async function savePromptNow() {
  const entry = editing.value
  if (!entry || promptDraft.value === promptOriginal.value) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  saving.value = true
  saveError.value = null
  try {
    await art.savePrompt(entry, promptDraft.value)
    promptOriginal.value = promptDraft.value
    savedAt.value = new Date().toTimeString().slice(0, 5)
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

/** 关 modal / 切 entry 前把 pending 的 debounce save 冲掉 */
function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  // fire-and-forget：editing 即将切换，不等结果
  if (editing.value && promptDraft.value !== promptOriginal.value) {
    const entry = editing.value
    const prompt = promptDraft.value
    void art.savePrompt(entry, prompt).catch((e) => console.error('[art flushSave] failed:', e))
  }
}

function onEditModalClose() {
  flushSave()
  editing.value = null
}

async function onDelete() {
  const entry = editing.value
  if (!entry) return
  if (!confirmingDelete.value) {
    confirmingDelete.value = true
    return
  }
  try {
    await art.remove(entry)
    editing.value = null
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
    confirmingDelete.value = false
  }
}

// === 刷新 ===
async function onRefresh() {
  await art.load()
}

// === 键盘：Esc 关 modal / Enter 确认新建 ===
function onKeydown(e: KeyboardEvent) {
  if (e.isComposing) return // IME 组词中的 Enter 是选词，不当确认
  if (e.key === 'Escape') {
    if (createCategory.value) onCreateModalClose()
    else if (editing.value) onEditModalClose()
  } else if (e.key === 'Enter' && createCategory.value && !creating.value) {
    onCreateConfirm()
  }
}

/** ISO → "HH:MM"（跟 SessionView shortTime 同款简版） */
function shortTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return ''
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  void art.load()
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  flushSave()
})

// 切项目 → 重扫
watch(
  () => project.current?.folder,
  () => {
    onEditModalClose()
    void art.load()
  },
)
</script>

<template>
  <div class="art-view">
    <!-- 无项目 empty state -->
    <div v-if="!project.current" class="empty">
      <ImageIcon :size="48" :stroke-width="1.5" />
      <h2>设定图</h2>
      <p>先在会话 tab 打开一个项目 —— 设定图存在项目的 <code>art/</code> 文件夹里</p>
    </div>

    <template v-else>
      <div class="toolbar">
        <FolderOpen :size="14" />
        <span class="project-name">{{ project.current.name }}</span>
        <span class="toolbar-spacer" />
        <button @click="onRefresh" :disabled="art.loading" title="重扫 art/ 文件夹">
          <RefreshCw :size="12" :class="{ spinning: art.loading }" />
          <span>刷新</span>
        </button>
      </div>

      <div class="sections">
        <section v-for="cat in ART_CATEGORIES" :key="cat" class="section">
          <div class="section-header">
            <h3>
              {{ ART_CATEGORY_LABELS[cat] }}
              <span class="count">{{ entriesOf(cat).length }}</span>
            </h3>
            <button class="new-btn" @click="onNew(cat)">
              <Plus :size="12" />
              <span>新建</span>
            </button>
          </div>

          <div v-if="entriesOf(cat).length === 0" class="section-empty">
            还没有{{ ART_CATEGORY_LABELS[cat] }}设定图 —— 点"新建"加一个，写 prompt 备用
          </div>

          <div v-else class="grid">
            <button
              v-for="entry in entriesOf(cat)"
              :key="entryKey(entry)"
              type="button"
              class="card"
              @click="onOpenEntry(entry)"
            >
              <div class="card-image" :class="{ placeholder: !imageUrls[entryKey(entry)] }">
                <img v-if="imageUrls[entryKey(entry)]" :src="imageUrls[entryKey(entry)]" :alt="entry.name" />
                <ImageIcon v-else :size="28" :stroke-width="1.5" />
              </div>
              <div class="card-footer">
                <span class="card-name">{{ entry.name }}</span>
                <span class="card-prompt-mark" :class="{ filled: entry.prompt.trim().length > 0 }">
                  {{ entry.prompt.trim() ? '有 prompt' : '无 prompt' }}
                </span>
              </div>
            </button>
          </div>
        </section>

        <div v-if="!hasAnyEntry && !art.loading" class="global-hint">
          玩家也可以直接把 png/jpg 丢进项目的 <code>art/characters/</code> 等目录，点"刷新"即可显示
        </div>
      </div>
    </template>

    <!-- 新建 modal -->
    <Teleport to="body">
      <div v-if="createCategory" class="modal-overlay" @mousedown.self="onCreateModalClose">
        <div class="modal" role="dialog" aria-modal="true" aria-label="新建设定图">
          <div class="modal-header">
            <Plus :size="16" />
            <h3>新建{{ createCategory ? ART_CATEGORY_LABELS[createCategory] : '' }}设定图</h3>
            <button @click="onCreateModalClose" class="modal-close" title="关闭 (Esc)">
              <X :size="16" />
            </button>
          </div>
          <div class="modal-body">
            <p class="modal-hint">
              名字就是文件名：<code>art/{{ createCategory }}/&lt;名字&gt;.prompt.txt</code>
            </p>
            <input
              v-model="createName"
              type="text"
              class="name-input"
              placeholder="如 hero / 主角"
              autofocus
            />
            <p v-if="createError" class="modal-error">{{ createError }}</p>
          </div>
          <div class="modal-actions">
            <button @click="onCreateModalClose" type="button">取消</button>
            <button
              @click="onCreateConfirm"
              type="button"
              class="primary"
              :disabled="!createName.trim() || creating"
            >
              {{ creating ? '创建中…' : '创建' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 编辑 modal -->
    <Teleport to="body">
      <div v-if="editing" class="modal-overlay" @mousedown.self="onEditModalClose">
        <div class="modal edit-modal" role="dialog" aria-modal="true" aria-label="编辑设定图">
          <div class="modal-header">
            <ImageIcon :size="16" />
            <h3>
              {{ editing.name }}
              <span class="category-tag">{{ ART_CATEGORY_LABELS[editing.category as ArtCategory] }}</span>
            </h3>
            <button @click="onEditModalClose" class="modal-close" title="关闭 (Esc)">
              <X :size="16" />
            </button>
          </div>
          <div class="modal-body">
            <div class="edit-image" :class="{ placeholder: !imageUrls[entryKey(editing)] }">
              <img v-if="imageUrls[entryKey(editing)]" :src="imageUrls[entryKey(editing)]" :alt="editing.name" />
              <div v-else class="edit-image-placeholder">
                <ImageIcon :size="40" :stroke-width="1.5" />
                <p>还没有图 —— v0.3+ 接生成；现在可以手放图片到 <code>art/{{ editing.category }}/{{ editing.name }}.png</code></p>
              </div>
            </div>

            <label class="prompt-label" for="art-prompt">Prompt</label>
            <textarea
              id="art-prompt"
              v-model="promptDraft"
              class="prompt-input"
              rows="6"
              placeholder="写这张图的画图 prompt（备用 —— v0.3+ 接生成时直接用）"
            />
            <div class="save-status">
              <span v-if="saving" class="saving">保存中…</span>
              <span v-else-if="saveError" class="save-error">保存失败：{{ saveError }}</span>
              <span v-else-if="savedAt" class="saved">已保存 {{ savedAt }}</span>
            </div>
          </div>
          <div class="modal-actions">
            <button
              @click="onDelete"
              type="button"
              class="danger"
              :class="{ 'confirm-delete': confirmingDelete }"
            >
              <Trash2 :size="12" />
              <span>{{ confirmingDelete ? '再点一次确认删除' : '删除' }}</span>
            </button>
            <span class="toolbar-spacer" />
            <button @click="onEditModalClose" type="button" class="primary">完成</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.art-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  color: var(--text-muted);
}
.empty h2 {
  font-size: 18px;
  font-weight: 500;
  color: var(--text);
  margin-top: 8px;
}
.empty p {
  font-size: 13px;
}
.empty code,
.global-hint code,
.modal-hint code,
.edit-image-placeholder code {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 0.9em;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 5px;
  color: var(--text);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  flex-shrink: 0;
}
.project-name {
  color: var(--accent);
  font-weight: 500;
  font-size: 12px;
}
.toolbar-spacer {
  flex: 1;
}
.toolbar button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}
.toolbar button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.toolbar button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.sections {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.section-header h3 {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 6px;
}
.count {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 400;
}
.new-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  background: transparent;
  color: var(--accent);
  border: 1px dashed var(--accent);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
}
.new-btn:hover {
  background: var(--accent-soft);
}
.section-empty {
  padding: 18px 14px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}
.card {
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
  transition: border-color 0.1s;
}
.card:hover {
  border-color: var(--accent);
}
.card-image {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  color: var(--text-muted);
  overflow: hidden;
}
.card-image.placeholder {
  border-bottom: 1px dashed var(--border);
  background: var(--accent-soft);
}
.card-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 8px;
}
.card-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-prompt-mark {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.7;
}
.card-prompt-mark.filled {
  color: var(--accent);
  opacity: 1;
}
.global-hint {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  padding: 8px 0 16px;
}

/* === modal（对齐 components/project 既有 modal 模式） === */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fade 0.12s ease-out;
}
.modal {
  width: min(480px, calc(100vw - 32px));
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  animation: rise 0.15s ease-out;
  overflow: hidden;
}
.edit-modal {
  width: min(560px, calc(100vw - 32px));
}
.modal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  color: var(--accent);
}
.modal-header h3 {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
}
.category-tag {
  font-size: 10px;
  color: var(--bg);
  background: var(--accent);
  border-radius: 3px;
  padding: 1px 5px;
  font-weight: 500;
}
.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}
.modal-close:hover {
  background: var(--hover);
  color: var(--text);
}
.modal-body {
  flex: 1;
  min-height: 0;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}
.modal-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
}
.modal-error {
  margin: 0;
  font-size: 12px;
  color: var(--error, #e53e3e);
}
.name-input {
  width: 100%;
  padding: 6px 10px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 5px;
  outline: none;
  font-size: 13px;
  font-family: inherit;
  box-sizing: border-box;
}
.name-input:focus {
  border-color: var(--accent);
}
.modal-actions {
  display: flex;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  align-items: center;
}
.modal-actions button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}
.modal-actions button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.modal-actions button.primary {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.modal-actions button.primary:hover:not(:disabled) {
  opacity: 0.85;
}
.modal-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.modal-actions button.danger {
  color: var(--error, #e53e3e);
  border-color: var(--error, #e53e3e);
}
.modal-actions button.danger.confirm-delete {
  background: var(--error, #e53e3e);
  color: #fff;
  animation: confirm-pulse 1s ease infinite;
}
@keyframes confirm-pulse {
  50% {
    transform: scale(1.03);
  }
}

/* === 编辑 modal 内部 === */
.edit-image {
  aspect-ratio: 16 / 9;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.edit-image.placeholder {
  border-style: dashed;
  background: var(--accent-soft);
}
.edit-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.edit-image-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  padding: 16px;
  text-align: center;
}
.edit-image-placeholder p {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
}
.prompt-label {
  font-size: 12px;
  color: var(--text-muted);
}
.prompt-input {
  width: 100%;
  padding: 8px 10px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 5px;
  outline: none;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.6;
  resize: vertical;
  box-sizing: border-box;
}
.prompt-input:focus {
  border-color: var(--accent);
}
.save-status {
  font-size: 11px;
  min-height: 14px;
}
.save-status .saving {
  color: var(--text-muted);
}
.save-status .saved {
  color: var(--accent);
}
.save-status .save-error {
  color: var(--error, #e53e3e);
}

@keyframes fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
