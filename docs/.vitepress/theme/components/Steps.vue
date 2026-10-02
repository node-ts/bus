<!-- Numbers the items of the ordered list inside it as a procedure. Leave a blank line after <Steps> and before
</Steps> so the list inside is parsed as markdown. -->
<template>
  <div class="steps">
    <slot />
  </div>
</template>

<style scoped>
.steps :deep(> ol) {
  counter-reset: step;
  list-style: none;
  padding-left: 0;
}

.steps :deep(> ol > li) {
  position: relative;
  counter-increment: step;
  margin: 0 0 0 15px;
  padding: 0 0 24px 33px;
  border-left: 2px solid var(--vp-c-divider);
}

.steps :deep(> ol > li:last-child) {
  border-left-color: transparent;
  padding-bottom: 0;
}

.steps :deep(> ol > li::before) {
  content: counter(step);
  position: absolute;
  top: -2px;
  left: -17px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-size: 14px;
  font-weight: 600;
  line-height: 32px;
  text-align: center;
}

.steps :deep(> ol > li > p:first-child) {
  margin-top: 2px;
  font-weight: 600;
}
</style>
