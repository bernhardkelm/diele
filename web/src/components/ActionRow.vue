<script setup lang="ts">
import HighlightedText from '@/components/HighlightedText.vue'
import ScrollingText from '@/components/ScrollingText.vue'
import { useStationRow } from '@/composables/useStationRow'
import type { ListAction } from '@/helpers/listActions'

interface ActionRowProps {
  action: ListAction
  /** Station key, mirrored onto the element so the ring can find and focus it */
  stationKey: string
  /** Whether this row is the list's single tab stop */
  active?: boolean
  /** Whether this row actually holds focus, which is what reads its line out */
  focused?: boolean
  /** Term filtering the list, marked up in the label */
  query?: string
  /** Whether the row sits inside an open section rather than in the list itself */
  nested?: boolean
}

const props = defineProps<ActionRowProps>()

const emit = defineEmits<{ run: [] }>()

const { attrs: stationAttrs, ownsEvent } = useStationRow({
  stationKey: () => props.stationKey,
  active: () => props.active,
  level: props.nested ? 2 : 1,
})

/**
 * Runs the action.
 * @param {KeyboardEvent} event - Key press being handled
 * @returns {void}
 */
function onKeydown(event: KeyboardEvent): void {
  if (!ownsEvent(event) || event.key !== 'Enter' || props.action.disabled) {
    return
  }

  event.preventDefault()
  emit('run')
}
</script>

<template>
  <li
    class="action row-shell row-marker-focus row-grammar"
    v-bind="stationAttrs"
    :class="{ 'action--off': action.disabled, 'action--nested': nested }"
    :aria-disabled="action.disabled ? true : undefined"
    @keydown="onKeydown"
    @click="!action.disabled && emit('run')"
  >
    <span class="action__name truncate">
      <HighlightedText :text="action.label" :query="query" />
    </span>

    <ScrollingText class="action__hint" :text="action.description" :focused="focused" />

    <span class="action__trail row-trail" aria-hidden="true">
      <span v-if="action.trail" class="action__note">{{ action.trail }}</span>
      <span class="action__chevron">▸</span>
    </span>
  </li>
</template>

<style scoped>
/* Deliberately the same grammar as a feature row: these sit in one list and one keyboard
   ring, so anything that set them apart visually would read as a different kind of control. */
.action {
  cursor: pointer;
}

.action--off {
  opacity: 0.4;
  cursor: default;
}

/* see AdminEntryRow: a row inside an open section sits one gutter deeper, and takes the same
   step so both levels keep one distance between the marker and the text */
.action--nested {
  --row-marker-left: var(--diele-space-8);

  padding-left: calc(var(--diele-space-6) * 2);
}

.action__name {
  color: var(--diele-fg);
}

/* see ScrollingText: it owns the clipping, because it has to lift it while looping */
.action__hint {
  min-width: 0;
}

@media (max-width: 640px) {
  .action {
    --row-marker-left: 0;

    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: var(--diele-space-2);
    padding-left: var(--diele-space-3);
  }

  .action--nested {
    --row-marker-left: var(--diele-space-2);

    padding-left: var(--diele-space-4);
  }

  .action__name {
    grid-column: 1;
  }

  .action__trail {
    grid-row: 1;
    grid-column: 2;
  }

  .action__hint {
    grid-row: 2;
    grid-column: 1 / -1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .action {
    transition: none;
  }
}
</style>
