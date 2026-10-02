<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import InstallCommand from './components/InstallCommand.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #home-hero-info-after>
      <InstallCommand command="npm i @node-ts/bus-core @node-ts/bus-messages" />
    </template>
  </Layout>
</template>
