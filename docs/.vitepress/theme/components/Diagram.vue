<script setup lang="ts">
import { withBase } from 'vitepress'

defineProps<{
  /** A committed SVG in docs/public, such as `/diagrams/message-flow.svg` */
  src: string
  /** What the diagram shows, for screen readers and search */
  alt: string
  /** An optional caption shown under the diagram */
  caption?: string
}>()
</script>

<template>
  <figure class="diagram">
    <img :src="withBase(src)" :alt="alt" loading="lazy" />
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
.diagram {
  margin: 24px 0;
}

.diagram img {
  width: 100%;
  height: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
}

figcaption {
  margin-top: 8px;
  font-size: 14px;
  color: var(--vp-c-text-2);
  text-align: center;
}
</style>
