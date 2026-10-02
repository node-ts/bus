<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ command: string }>()
const copied = ref(false)

const copy = async () => {
  try {
    await navigator.clipboard.writeText(props.command)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // The clipboard can be unavailable, e.g. without a secure context. The command is still selectable.
  }
}
</script>

<template>
  <div class="install-command">
    <code><span class="prompt" aria-hidden="true">$</span>{{ command }}</code>
    <button
      type="button"
      :aria-label="copied ? 'Copied' : 'Copy the install command'"
      @click="copy"
    >
      {{ copied ? 'Copied' : 'Copy' }}
    </button>
  </div>
</template>

<style scoped>
.install-command {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  max-width: 100%;
  margin-top: 24px;
  padding: 8px 8px 8px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}

.install-command code {
  overflow-x: auto;
  white-space: nowrap;
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  color: var(--vp-c-text-1);
}

.prompt {
  margin-right: 10px;
  color: var(--vp-c-brand-1);
  user-select: none;
}

.install-command button {
  flex-shrink: 0;
  padding: 4px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  transition:
    color 0.2s,
    border-color 0.2s;
}

.install-command button:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
</style>
