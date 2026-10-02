<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** The package name without the `@node-ts/` scope, such as `bus-sqs` */
  pkg: string
}>()

const name = computed(() => `@node-ts/${props.pkg}`)
const npm = computed(() => `https://www.npmjs.com/package/${name.value}`)
const source = computed(
  () => `https://github.com/node-ts/bus/tree/master/packages/${props.pkg}`
)
const badge = computed(
  () => `https://img.shields.io/npm/v/${name.value}?label=npm&color=0d9488`
)
</script>

<template>
  <p class="package-badge">
    <a class="name" :href="npm" target="_blank" rel="noreferrer">{{ name }}</a>
    <a :href="npm" target="_blank" rel="noreferrer">
      <img
        :src="badge"
        :alt="`${name} version on npm`"
        height="20"
        loading="lazy"
      />
    </a>
    <a class="source" :href="source" target="_blank" rel="noreferrer">Source</a>
  </p>
</template>

<style scoped>
.package-badge {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}

.package-badge a {
  text-decoration: none;
}

.name {
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  font-weight: 600;
}

.package-badge img {
  display: block;
}

.source {
  margin-left: auto;
  font-size: 14px;
}
</style>
