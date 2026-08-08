<script setup lang="ts">
import { computed } from 'vue'
import ScrollingText from '@/components/ScrollingText.vue'
import { useStationRow } from '@/composables/useStationRow'
import type { RowTarget } from '@/types/portal'

interface AdminHiddenRowProps {
  entry: RowTarget
  /** Whether the portal keeps this entry out of everyone's list */
  hidden: boolean
  /** Station key, mirrored onto the element so the ring can find and focus it */
  stationKey: string
  /** Whether this row is the list's single tab stop */
  active?: boolean
  /** Whether this row actually holds focus, which is what reads its line out */
  focused?: boolean
  busy?: boolean
}

const props = defineProps<AdminHiddenRowProps>()

const emit = defineEmits<{ run: [] }>()

const { attrs: stationAttrs, ownsEvent } = useStationRow({
  stationKey: () => props.stationKey,
  active: () => props.active,
  level: 3,
})

const name = computed(() =>
  props.entry.detail ? `${props.entry.detail}/${props.entry.name}` : props.entry.name,
)

// the trail word is a glyph as far as assistive technology is concerned, so the reach of the
// switch is said here: this row decides what every account sees, not only the one pressing it
const label = computed(() => `${name.value}, ${props.hidden ? 'hidden from everyone' : 'shown'}`)

/**
 * Flips whether the portal carries the entry at all. `d` as well as Enter, so the key means
 * the same thing it does on every other row that switches something.
 * @param {KeyboardEvent} event - Key press being handled
 * @returns {void}
 */
function onKeydown(event: KeyboardEvent): void {
  const bare = !event.metaKey && !event.ctrlKey && !event.altKey
  if (!ownsEvent(event) || props.busy || !bare) {
    return
  }

  if (event.key !== 'Enter' && event.key !== 'd') {
    return
  }

  event.preventDefault()
  emit('run')
}
</script>

<template>
  <li
    class="produced row-shell row-marker-focus"
    v-bind="stationAttrs"
    :class="{ 'produced--off': hidden }"
    :aria-label="label"
    @keydown="onKeydown"
    @click="emit('run')"
  >
    <!-- A group and a repo run far past the column, so the name reads itself out on focus the
         way a repo row's detail does, rather than ending in an ellipsis nothing can open. -->
    <ScrollingText class="produced__name" :text="name" :focused="focused" />

    <span class="produced__detail truncate">
      {{ hidden ? 'kept out of everyone list' : 'in everyone list' }}
    </span>

    <span class="produced__trail row-trail" aria-hidden="true">
      <span class="produced__switch" :class="{ 'produced__switch--off': hidden }">
        {{ hidden ? 'off' : 'on' }}
      </span>
    </span>
  </li>
</template>

<style scoped>
/* Its own tracks rather than the list's, the way the form these sit under has its own: a repo
   name is far longer than a card's label, and on the shared tracks it would widen the first one
   for every row in the list - so opening a connection stepped the whole panel sideways. Spanning
   instead, nothing here is measured against the rows above.
   The gutter lines them up with the form they belong to, rather than sitting one step short of
   it: see the list's own `--row-deep-gutter`. */
.produced {
  --row-gutter: var(--row-deep-gutter, calc(var(--diele-space-6) * 3));
  --row-marker-left: calc(var(--row-gutter) - var(--diele-space-4));

  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: baseline;
  gap: var(--diele-space-4);
  cursor: pointer;
}

.produced--off {
  opacity: 0.55;
}

.produced__name {
  color: var(--diele-fg);
}

/* see ScrollingText: it owns the clipping, because it has to lift it while looping */
.produced__detail {
  min-width: 0;
}

/* see AdminRowActions: the word is the state the row is in, and the off one keeps the colour
   the off badges have always used */
.produced__switch--off {
  color: var(--diele-status-pending);
}

@media (--diele-compact) {
  .produced {
    --row-gutter: var(--diele-space-6);
    --row-marker-left: var(--diele-space-2);

    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: var(--diele-space-2);
  }

  .produced__name {
    grid-column: 1;
  }

  .produced__trail {
    grid-row: 1;
    grid-column: 2;
  }

  .produced__detail {
    grid-row: 2;
    grid-column: 1 / -1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .produced {
    transition: none;
  }
}
</style>
