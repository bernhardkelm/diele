<script setup lang="ts">
import HistoryRow from '@/features/portal/HistoryRow.vue'
import type { HistoryTarget } from '@/types/portal'
import type { Indexed } from '@/features/portal/launchTargets'

interface HistoryListProps {
  pages: ReadonlyArray<Indexed<HistoryTarget>>
  /** Position of the launcher highlight; omitted while nothing is selected */
  activeIndex?: number
  /** Current search term, marked up in the rows */
  query?: string
}

defineProps<HistoryListProps>()
const emit = defineEmits<{ launch: [page: HistoryTarget] }>()
</script>

<template>
  <ul class="history row-tracks" aria-label="Visited before">
    <HistoryRow
      v-for="entry in pages"
      :key="entry.item.ref"
      :page="entry.item"
      :active="entry.index === activeIndex"
      :query="query"
      @launch="emit('launch', entry.item)"
    />
  </ul>
</template>

<style scoped>
/* see SiteList: the same list, for pages visited rather than saved.
   A page sets its own title, so a long or lookalike one must never squeeze its address out: the
   address column keeps a floor the title cannot take from it. */
.history {
  --history-tracks: minmax(0, auto) minmax(var(--history-address), 1fr) auto;
  --history-address: 20ch;

  width: 100%;
  max-width: var(--diele-content-width);
  padding: 0;
  list-style: none;
  border-bottom: 3px solid var(--diele-rule);
}

@supports (grid-template-columns: subgrid) {
  .history {
    grid-template-columns: var(--history-tracks);
  }
}

@media (--diele-compact) {
  .history {
    --history-address: 14ch;
  }
}
</style>
