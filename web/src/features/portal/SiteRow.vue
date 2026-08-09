<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import HighlightedText from '@/components/HighlightedText.vue'
import StatusDot from '@/components/StatusDot.vue'
import { useRevealOnActive } from '@/composables/useRevealOnActive'
import type { SuggestionTarget } from '@/types/portal'
import type { ApiHealthReading } from '@diele/common'

interface SiteRowProps {
  site: SuggestionTarget
  /** Whether the launcher highlight currently sits on this row */
  active?: boolean
  /** Whether a local server answered this port; only ever set for localhost entries */
  live?: boolean
  /** How it last answered; only ever set for a site someone bound a liveness source to */
  status?: ApiHealthReading
  /** Current search term, marked up in the row's name and host */
  query?: string
}

const props = defineProps<SiteRowProps>()
const emit = defineEmits<{ launch: [] }>()

useRevealOnActive(useTemplateRef<HTMLElement>('root'), () => props.active)

// A binding wins over the loopback probe: someone said what this row reports, and the probe can
// only ever say "something answered" where a binding says how.
const dot = computed<{ status: ApiHealthReading; name: string } | undefined>(() => {
  if (props.status) {
    return { status: props.status, name: props.site.name }
  }

  return props.live ? { status: { state: 'up' }, name: `${props.site.name} is running` } : undefined
})

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
        <StatusDot v-if="dot" :status="dot.status" :name="dot.name" />
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
@media (--diele-compact) {
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
