<script setup lang="ts">
import { computed } from 'vue'
import type { RowAction, RowActionId } from '@/features/admin/adminRowActions'

interface AdminRowActionsProps {
  actions: ReadonlyArray<RowAction>
  /** Index the left and right keys selected, 0 being the row itself; only set while focused */
  activeAction?: number
  /** Name of the row these belong to, so each action reads as its own thing */
  name: string
  busy?: boolean
  /** Whether the delete waits for its second press, which leaves its word alone asking for it */
  armed?: boolean
}

const props = defineProps<AdminRowActionsProps>()

const emit = defineEmits<{ run: [id: RowActionId] }>()

// Anything with a word of its own, keeping the index it holds in the ring so the arrows and
// the trail agree. Usually that skips index 0, which is the row itself and has no word; a
// feature that is only a switch has its switch there, and it is the whole of what it shows.
// Index 0 never draws as picked: it is where the selection rests before the arrows are used,
// so painting it would mark a word as chosen on every row that had not been touched.
//
// While the delete is armed its button stays mounted and asks again in place: a pointer focuses
// the button it presses, and taking that button away moves focus off the row, which disarms it
// before the second press can land. The other words step aside so the question stands alone.
const trail = computed(() =>
  props.actions
    .map((action, index) => ({ action, index }))
    .filter((entry) => entry.action.label.length > 0)
    .filter((entry) => !props.armed || entry.action.id === 'remove'),
)

/**
 * Returns whether a button is the delete waiting for its second press.
 * @param {RowAction} action - Action being rendered
 * @returns {boolean} - True for the armed delete
 */
function isArmed(action: RowAction): boolean {
  return props.armed === true && action.id === 'remove'
}

/**
 * Names an action for assistive technology, since the trail words alone read as loose text.
 * @param {RowAction} action - Action being rendered
 * @returns {string} - What the button does, and to what
 */
function labelFor(action: RowAction): string {
  if (isArmed(action)) {
    return `Press again to delete ${props.name}`
  }

  if (action.id === 'up') {
    return `Move ${props.name} up`
  }

  if (action.id === 'down') {
    return `Move ${props.name} down`
  }

  return `${action.label}: ${props.name}`
}
</script>

<template>
  <span class="actions">
    <button
      v-for="{ action, index } in trail"
      :key="action.id"
      class="actions__item"
      :class="[
        `actions__item--${action.tone ?? 'plain'}`,
        {
          'actions__item--picked': activeAction === index && index > 0,
          'actions__item--persistent': action.persistent,
          'actions__item--armed': isArmed(action),
        },
      ]"
      type="button"
      tabindex="-1"
      :disabled="busy || action.disabled"
      :aria-label="labelFor(action)"
      @click.stop="emit('run', action.id)"
    >
      <span
        v-if="action.id === 'up' || action.id === 'down'"
        class="actions__caret"
        :class="{ 'actions__caret--up': action.id === 'up' }"
        aria-hidden="true"
        >{{ action.label }}</span
      >
      <template v-else>{{ isArmed(action) ? 'press again to delete' : action.label }}</template>
    </button>
  </span>
</template>

<style scoped>
.actions {
  display: flex;
  gap: var(--diele-space-2);
  align-items: baseline;
}

/* Revealed rather than inserted, so the trail reserves the same width on every row and the
   columns do not shift as the pointer crosses the list. The row itself does the revealing. */
.actions__item {
  opacity: 0;
  transition:
    color var(--diele-transition),
    opacity var(--diele-transition);
}

.actions__item--persistent {
  opacity: 1;
}

/* The off state keeps the colour the soon and off badges have always used, so a switch says
   which way it is set without having to be read. */
.actions__item--off {
  color: var(--diele-status-pending);
}

.actions__item--danger:hover:not(:disabled) {
  color: var(--diele-status-down);
}

/* the arrow-picked word takes the accent, the way a repo's selected quick link does */
.actions__item--picked:not(:disabled) {
  color: var(--diele-accent);
  text-decoration: underline;
}

/* see AdminEntryRow .entry__confirm: the question a destructive press asks takes the colour of
   deleting, and stays on screen without the row revealing it. Stated after the picked word, which
   would otherwise take it back to the accent. */
.actions__item--armed,
.actions__item--armed:not(:disabled) {
  color: var(--diele-status-down);
  text-decoration: none;
  opacity: 1;
}

/* One glyph for both directions, the same caret the feature rows expand with, turned over for
   up. Two different characters render at two different weights in the mono face. */
.actions__caret {
  display: inline-block;
  font-size: var(--diele-text-xs);
  line-height: 1;
}

.actions__caret--up {
  transform: rotate(180deg);
}
</style>
