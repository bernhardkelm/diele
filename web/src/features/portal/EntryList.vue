<script setup lang="ts">
import EntryRow from '@/features/portal/EntryRow.vue'
import LoadingDots from '@/components/LoadingDots.vue'
import type { EntrySortKey, SortDirection } from '@/composables/useEntrySort'
import type { Indexed } from '@/features/portal/launchTargets'
import type { RowTarget } from '@/types/portal'

interface EntryListProps {
  entries: ReadonlyArray<Indexed<RowTarget>>
  sortKey: EntrySortKey
  sortDirection: SortDirection
  /** Position of the launcher highlight; omitted while the filter bar is closed */
  activeIndex?: number
  /** Action selected on the highlighted row, 0 being the entry itself */
  activeAction?: number
  /** Whether these rows are being reloaded behind the list */
  refreshing?: boolean
  /** Current search term, marked up in the rows */
  query?: string
}

const props = defineProps<EntryListProps>()
const emit = defineEmits<{ sort: [key: EntrySortKey]; launch: [entry: RowTarget] }>()

const COLUMNS: ReadonlyArray<{ key: EntrySortKey; label: string }> = [
  { key: 'name', label: 'name' },
  { key: 'activity', label: 'last updated' },
]

/**
 * Returns the accessible name of a sort button, naming the order a press would produce.
 * @param {EntrySortKey} key - Column the button sorts by
 * @param {string} label - Human readable column name
 * @returns {string} - Label for assistive technology
 */
function sortLabel(key: EntrySortKey, label: string): string {
  if (props.sortKey !== key) {
    return `Sort by ${label}`
  }
  return props.sortDirection === 'asc'
    ? `Sorted by ${label}, ascending. Press to reverse`
    : `Sorted by ${label}, descending. Press to reverse`
}
</script>

<template>
  <section class="projects">
    <LoadingDots v-if="refreshing" class="projects__refresh" title="Reloading entries" />

    <div class="projects__head">
      <button
        v-for="column in COLUMNS"
        :key="column.key"
        type="button"
        class="sort"
        :class="{ 'sort--active': sortKey === column.key, [`sort--${column.key}`]: true }"
        :aria-label="sortLabel(column.key, column.label)"
        @click="emit('sort', column.key)"
      >
        {{ column.label
        }}<span class="sort__arrow" aria-hidden="true">{{
          sortKey === column.key ? (sortDirection === 'asc' ? '↑' : '↓') : ''
        }}</span>
      </button>
    </div>

    <ul class="projects__list">
      <EntryRow
        v-for="entry in entries"
        :key="entry.item.ref"
        :entry="entry.item"
        :active="entry.index === activeIndex"
        :active-action="entry.index === activeIndex ? activeAction : undefined"
        :query="query"
        @launch="emit('launch', entry.item)"
      />
    </ul>
  </section>
</template>

<style scoped>
.projects {
  position: relative;
  width: 100%;
  max-width: 720px;
}

/* corner of the section rather than the head, so it never crowds the sort labels */
.projects__refresh {
  position: absolute;
  top: 0;
  right: var(--diele-space-2);
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-sm);
  color: var(--diele-fg-muted);
}

.projects__head {
  display: flex;
  align-items: baseline;
  padding: 0 0 var(--diele-space-2) var(--diele-space-6);
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-sm);
}

.sort {
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* reversed so the reserved arrow slot sits left of the label, which puts the label's edge
   on the times below it */
.sort--activity {
  display: inline-flex;
  flex-direction: row-reverse;
  margin-left: auto;
}

.sort--activity .sort__arrow {
  margin-left: 0;
  margin-right: var(--diele-space-2);
}

.sort:hover,
.sort:focus-visible,
.sort--active {
  color: var(--diele-fg);
  outline: none;
}

.sort:focus-visible {
  text-decoration: underline;
}

/* reserved so the labels do not shift when the arrow appears */
.sort__arrow {
  display: inline-block;
  width: 1ch;
  margin-left: var(--diele-space-2);
}

.projects__list {
  padding: 0;
  list-style: none;
  /* heavier than the hairlines between rows, so it opens the section without a heading */
  border-top: 3px solid var(--diele-rule);
}

/* follows the rows, which drop their gutter at this width, so the labels stay over them */
@media (max-width: 640px) {
  .projects__head {
    padding-left: 0;
  }
}
</style>
