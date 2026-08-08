<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import HighlightedText from '@/components/HighlightedText.vue'
import StatusDot from '@/components/StatusDot.vue'
import { useRevealOnActive } from '@/composables/useRevealOnActive'
import type { SuggestionTarget } from '@/types/portal'

interface SiteRowProps {
  site: SuggestionTarget
  /** Whether the launcher highlight currently sits on this row */
  active?: boolean
  /** Whether a local server answered this port; only ever set for localhost entries */
  live?: boolean
  /** Current search term, marked up in the row's name and host */
  query?: string
}

const props = defineProps<SiteRowProps>()
const emit = defineEmits<{ launch: [] }>()

useRevealOnActive(useTemplateRef<HTMLElement>('root'), () => props.active)

const host = computed(() => {
  if (props.site.display) {
    return props.site.display
  }

  try {
    return new URL(props.site.url).hostname.replace(/^www\./, '')
  } catch {
    return props.site.url
  }
})
</script>

<template>
  <li
    ref="root"
    class="site row-grammar-pass"
    :class="{ 'site--active': active, 'row-marker': active }"
  >
    <!-- no target: a saved site replaces the portal, the way a typed url would -->
    <a class="site__link row-grammar" :href="site.url" rel="noopener" @click="emit('launch')">
      <!-- dot inside the label cell, so a row that has one keeps the shared columns -->
      <span class="site__name truncate">
        <StatusDot v-if="live" :status="{ state: 'up' }" :name="`${site.name} is running`" />
        <HighlightedText :text="site.name" :query="query" />
      </span>
      <span class="site__host truncate"><HighlightedText :text="host" :query="query" /></span>
      <span class="site__enter" aria-hidden="true">↵</span>
    </a>
  </li>
</template>

<style scoped>
.site {
  --row-marker-top: var(--diele-space-3);

  position: relative;
  scroll-margin-block: var(--diele-reveal-gap);
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-lg);
}

.site + .site {
  border-top: 1px solid var(--diele-rule);
}

/* see base.css .row-grammar; the link is what paints the tracks the row hands down */
.site__link {
  padding: var(--diele-space-3) var(--diele-space-2) var(--diele-space-3) var(--diele-space-6);
  color: var(--diele-fg-muted);
  transition: color var(--diele-transition);
}

.site__link:hover,
.site__link:focus-visible,
.site--active .site__link {
  color: var(--diele-fg);
  outline: none;
}

.site__name {
  color: var(--diele-fg);
  font-weight: 600;
}

/* the dot is inline-block, so it flows with the name and leaves the ellipsis to the text */
.site__name :deep(.status) {
  margin-right: var(--diele-space-2);
}

/* the highlighted site is what Enter opens, so it says so */
.site__enter {
  opacity: 0;
  transition: opacity var(--diele-transition);
}

.site--active .site__enter {
  opacity: 1;
}

/* see ProjectRow: the marker indents its own row rather than every row reserving a gutter */
@media (max-width: 640px) {
  .site__link {
    padding-left: 0;
  }

  .site--active .site__link {
    padding-left: var(--diele-space-3);
  }

  .site--active {
    --row-marker-left: 0;
  }
}
</style>
