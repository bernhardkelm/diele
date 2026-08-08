<script setup lang="ts">
import { computed } from 'vue'
import { highlightPieces } from '@/helpers/highlightRanges'

interface HighlightedTextProps {
  text: string
  /** Current search term; whatever of `text` it matched is marked */
  query?: string
}

const props = defineProps<HighlightedTextProps>()

const pieces = computed(() => highlightPieces(props.text, props.query ?? ''))
</script>

<template>
  <component
    :is="piece.matched ? 'mark' : 'span'"
    v-for="(piece, index) in pieces"
    :key="index"
    :class="piece.matched ? 'hit' : undefined"
    >{{ piece.text }}</component
  >
</template>

<style scoped>
.hit {
  color: inherit;
  background: var(--diele-hit);
  border-radius: 2px;
}
</style>
