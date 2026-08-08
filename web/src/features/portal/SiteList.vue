<script setup lang="ts">
import SiteRow from '@/features/portal/SiteRow.vue'
import type { SuggestionTarget } from '@/types/portal'
import type { Indexed } from '@/features/portal/launchTargets'

interface SiteListProps {
  sites: ReadonlyArray<Indexed<SuggestionTarget>>
  /** Position of the launcher highlight; omitted while nothing is selected */
  activeIndex?: number
  /** Reports whether a saved localhost entry currently has a server listening */
  isLive?: (site: SuggestionTarget) => boolean
  /** Current search term, marked up in the rows */
  query?: string
}

defineProps<SiteListProps>()
const emit = defineEmits<{ launch: [site: SuggestionTarget] }>()
</script>

<template>
  <ul class="sites row-tracks">
    <SiteRow
      v-for="entry in sites"
      :key="entry.item.ref"
      :site="entry.item"
      :active="entry.index === activeIndex"
      :live="isLive?.(entry.item)"
      :query="query"
      @launch="emit('launch', entry.item)"
    />
  </ul>
</template>

<style scoped>
/* No collapse at the breakpoint, unlike the command list: site names are short enough that
   the host still fits beside one, so the rows stay on one line where a hinted row would stack. */
.sites {
  /* site names are short, so their hosts start well left of where a settings hint does */
  --diele-row-label: 16ch;

  width: 100%;
  max-width: 720px;
  padding: 0;
  list-style: none;
  border-bottom: 3px solid var(--diele-rule);
}
</style>
