<script setup lang="ts">
import LoadingDots from '@/components/LoadingDots.vue'
</script>

<template>
  <p class="loading" role="status">Loading projects<LoadingDots /></p>
</template>

<style scoped>
.loading {
  width: 100%;
  max-width: var(--diele-content-width);
  padding-left: var(--diele-space-6);
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-sm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--diele-fg-muted);
}
</style>
