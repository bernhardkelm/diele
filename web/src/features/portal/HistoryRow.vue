<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import HighlightedText from '@/components/HighlightedText.vue'
import { useRevealOnActive } from '@/composables/useRevealOnActive'
import type { HistoryTarget } from '@/types/portal'

interface HistoryRowProps {
  page: HistoryTarget
  /** Whether the launcher highlight currently sits on this row */
  active?: boolean
  /** Current search term, marked up in the row's title and address */
  query?: string
}

const props = defineProps<HistoryRowProps>()
const emit = defineEmits<{ launch: [] }>()

useRevealOnActive(useTemplateRef<HTMLElement>('root'), () => props.active)

// the trail word is a glyph as far as assistive technology is concerned, so where the row came
// from is said here instead
const label = computed(() =>
  props.page.title
    ? `${props.page.name}, ${props.page.display}, visited before`
    : `${props.page.display}, visited before`,
)
</script>

<template>
  <li
    ref="root"
    class="visit row-grammar-pass"
    :class="{ 'visit--active': active, 'row-marker': active }"
  >
    <!-- no target: a visited page replaces the portal, the way a typed url would -->
    <a
      class="visit__link row-grammar"
      :href="page.url"
      rel="noopener"
      :aria-label="label"
      @click="emit('launch')"
    >
      <span class="visit__name truncate"><HighlightedText :text="page.name" :query="query" /></span>
      <!-- A page names itself, so its address is what tells a lookalike title apart. Without a
           title the name already is the address, and saying it twice would only crowd the row. -->
      <span class="visit__address truncate">
        <HighlightedText v-if="page.title" :text="page.display" :query="query" />
      </span>
      <span class="visit__trail row-trail" aria-hidden="true">
        <span class="visit__source">history</span>
        <span class="visit__enter">↵</span>
      </span>
    </a>
  </li>
</template>

<style scoped>
/* see SiteRow: the same row, with a word in the trail saying it was visited rather than saved */
.visit {
  --row-marker-top: var(--diele-space-3);

  position: relative;
  scroll-margin-block: var(--diele-reveal-gap);
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-lg);
}

.visit + .visit {
  border-top: 1px solid var(--diele-rule);
}

.visit__link {
  padding: var(--diele-space-3) var(--diele-space-2) var(--diele-space-3) var(--diele-space-6);
  color: var(--diele-fg-muted);
  transition: color var(--diele-transition);
}

.visit__link:hover,
.visit__link:focus-visible,
.visit--active .visit__link {
  color: var(--diele-fg);
  outline: none;
}

.visit__name {
  color: var(--diele-fg);
}

.visit__source {
  color: var(--diele-fg-muted);
}

/* without subgrid each link lays out its own tracks, so it takes the list's from here instead */
@supports not (grid-template-columns: subgrid) {
  .visit__link {
    grid-template-columns: var(--history-tracks);
  }
}

/* the highlighted page is what Enter opens, so it says so */
.visit__enter {
  opacity: 0;
  transition: opacity var(--diele-transition);
}

.visit--active .visit__enter {
  opacity: 1;
}

/* see SiteRow: the marker indents its own row rather than every row reserving a gutter */
@media (--diele-compact) {
  .visit__link {
    padding-left: 0;
  }

  .visit--active .visit__link {
    padding-left: var(--diele-space-3);
  }

  .visit--active {
    --row-marker-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .visit__link,
  .visit__enter {
    transition: none;
  }
}
</style>
