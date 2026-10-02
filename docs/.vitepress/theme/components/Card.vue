<script setup lang="ts">
import { computed } from 'vue'
import { withBase } from 'vitepress'

const props = defineProps<{
  /** The card's heading */
  title: string
  /** Where the card links to: a site path such as `/transports/rabbitmq`, or a full URL */
  link?: string
  /** A short label above the title, such as a package name */
  tag?: string
}>()

const href = computed(() => (props.link ? withBase(props.link) : undefined))
const external = computed(() => !!props.link && /^https?:\/\//.test(props.link))
</script>

<template>
  <component
    :is="href ? 'a' : 'div'"
    class="card"
    :class="{ linked: !!href }"
    :href="href"
    :target="external ? '_blank' : undefined"
    :rel="external ? 'noreferrer' : undefined"
  >
    <span v-if="tag" class="tag">{{ tag }}</span>
    <span class="title">{{ title }}</span>
    <span class="details"><slot /></span>
  </component>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: 100%;
  padding: 20px;
  border: 1px solid var(--vp-c-bg-soft);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  text-decoration: none !important;
  transition:
    border-color 0.25s,
    transform 0.25s;
}

.card.linked:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.tag {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-brand-1);
}

.title {
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.details {
  font-size: 14px;
  line-height: 22px;
  color: var(--vp-c-text-2);
}

.details :deep(p) {
  margin: 0;
}
</style>
