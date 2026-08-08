<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import HighlightedText from '@/components/HighlightedText.vue'
import { useRevealOnActive } from '@/composables/useRevealOnActive'
import { actionsFor } from '@/features/portal/launchActions'
import { formatRelativeTime } from '@/helpers/relativeTime'
import type { RowTarget } from '@/types/portal'

interface EntryRowProps {
  entry: RowTarget
  /** Whether the launcher highlight currently sits on this row */
  active?: boolean
  /** Action the left and right keys selected, 0 being the entry itself; only set while active */
  activeAction?: number
  /** Current search term, marked up in the row's name */
  query?: string
}

const props = defineProps<EntryRowProps>()
const emit = defineEmits<{ launch: [] }>()

useRevealOnActive(useTemplateRef<HTMLElement>('root'), () => props.active)

const activity = computed(() => formatRelativeTime(props.entry.timestamp ?? ''))

// index 0 is the row's own link, which the main anchor already renders
const links = computed(() => actionsFor(props.entry).slice(1))
</script>

<template>
  <li
    ref="root"
    class="row"
    :class="{
      'row--active': active,
      'row-marker': active,
      'row--link-selected': active && (activeAction ?? 0) > 0,
    }"
  >
    <a class="row__main" :href="entry.url" rel="noopener" @click="emit('launch')">
      <span class="row__name truncate"
        ><span v-if="entry.detail" class="row__namespace"
          ><HighlightedText :text="entry.detail" :query="query" />/</span
        ><HighlightedText :text="entry.name" :query="query"
      /></span>
    </a>

    <span class="row__links">
      <a
        v-for="(link, index) in links"
        :key="link.href"
        class="row__link"
        :class="{ 'row__link--active': activeAction === index + 1 }"
        :href="link.href"
        :title="`${entry.name}: ${link.title}`"
        :aria-label="`${entry.name}: ${link.title}`"
        rel="noopener"
        @click="emit('launch')"
        >{{ link.label }}</a
      >
    </span>

    <span class="row__activity">{{ activity }}</span>
  </li>
</template>

<style scoped>
.row {
  --row-marker-top: var(--diele-space-3);

  position: relative;
  display: flex;
  scroll-margin-block: var(--diele-reveal-gap);
  align-items: baseline;
  gap: var(--diele-space-4);
  padding: var(--diele-space-3) 0 var(--diele-space-3) var(--diele-space-6);
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-lg);
}

.row + .row {
  border-top: 1px solid var(--diele-rule);
}

.row__main {
  display: flex;
  align-items: baseline;
  flex: 1;
  min-width: 0;
  color: var(--diele-fg-muted);
  transition: color var(--diele-transition);
}

.row__main:hover,
.row__main:focus-visible,
.row--active .row__main {
  color: var(--diele-fg);
  outline: none;
}

/* an arrow-selected quick link takes the emphasis off the repo's own link */
.row--link-selected .row__main:not(:hover) {
  color: var(--diele-fg-muted);
}

.row__main:focus-visible .row__name {
  text-decoration: underline;
}

.row__name {
  color: var(--diele-fg);
}

.row__namespace {
  color: var(--diele-fg-muted);
}

/* last in the row and fixed, so the times end on the section's right edge and the list
   header can line "last updated" up with them */
.row__activity {
  flex: none;
  width: 5rem;
  text-align: right;
  font-size: var(--diele-text-md);
  color: var(--diele-fg-muted);
  transition: color var(--diele-transition);
}

.row:hover .row__activity,
.row--active .row__activity {
  color: var(--diele-fg);
}

.row__links {
  display: flex;
  flex: none;
  justify-content: flex-end;
  gap: var(--diele-space-3);
  font-size: var(--diele-text-md);
  color: var(--diele-fg-muted);
  opacity: 0;
  transition: opacity var(--diele-transition);
}

.row:hover .row__links,
.row:focus-within .row__links,
.row--active .row__links {
  opacity: 1;
}

.row__link:hover,
.row__link:focus-visible,
.row__link--active {
  color: var(--diele-fg);
  text-decoration: underline;
  outline: none;
}

/* no hovering pointer means the links would never appear, so they stay visible there */
@media (hover: none) {
  .row__links {
    opacity: 1;
  }
}

/* the gutter is the well the marker sits in, and a phone has too little width to hold one
   open for every row; the marker indents the one row it is on instead */
@media (max-width: 640px) {
  .row {
    padding-left: 0;
  }

  .row--active {
    --row-marker-left: 0;

    padding-left: var(--diele-space-3);
  }
}
</style>
