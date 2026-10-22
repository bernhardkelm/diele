<script setup lang="ts">
import { computed } from 'vue'
import HighlightedText from '@/components/HighlightedText.vue'
import ScrollingText from '@/components/ScrollingText.vue'
import { useArmedAction } from '@/composables/useArmedAction'
import { useStationRow } from '@/composables/useStationRow'
import type { SettingsItem } from '@/features/settings/settingsSections'

interface SettingsItemRowProps {
  item: SettingsItem
  /** Station key, mirrored onto the element so the ring can find and focus it */
  stationKey: string
  /** Whether this row is the list's single tab stop */
  active?: boolean
  /** Whether this row actually holds focus, which is what reads its line out */
  focused?: boolean
  /** Term filtering the list, marked up in the label */
  query?: string
  /** Whether its removal is on its way, so a second press does not send it twice */
  busy?: boolean
}

const props = defineProps<SettingsItemRowProps>()

const emit = defineEmits<{ remove: [] }>()

const { attrs: stationAttrs, ownsEvent } = useStationRow({
  stationKey: () => props.stationKey,
  active: () => props.active,
  level: 2,
})

// see AdminEntryRow: a removal nothing undoes asks twice, on the row rather than in a dialog
const { armed, press, onFocusout } = useArmedAction()

const label = computed(() => `${props.item.label}, ${props.item.detail}`)

/**
 * Removes the row, arming first where it asks before removing. Every route into removing goes
 * through here, so the trail word asks the same question the key does.
 * @returns {void}
 */
function remove(): void {
  if (props.busy) {
    return
  }

  if (props.item.confirm) {
    press(() => emit('remove'))
    return
  }

  emit('remove')
}

/**
 * Runs the row's key map: Enter removes it, as do the keys an admin row deletes with. Only when
 * the row itself is the target.
 * @param {KeyboardEvent} event - Key press being handled
 * @returns {void}
 */
function onKeydown(event: KeyboardEvent): void {
  const bare = !event.metaKey && !event.ctrlKey && !event.altKey
  const keys = ['Enter', 'x', 'Delete', 'Backspace']

  if (!ownsEvent(event) || !bare || !keys.includes(event.key)) {
    return
  }

  event.preventDefault()
  remove()
}
</script>

<template>
  <li
    class="item row-shell row-marker-focus row-grammar"
    v-bind="stationAttrs"
    :aria-label="label"
    @keydown="onKeydown"
    @focusout="onFocusout"
  >
    <span class="item__name truncate">
      <HighlightedText :text="item.label" :query="query" />
    </span>

    <ScrollingText class="item__detail" :text="item.detail" :focused="focused" />

    <span class="item__trail row-trail">
      <span v-if="armed" class="item__confirm" role="status">press again to delete</span>

      <template v-else>
        <span v-if="item.note" class="item__note" aria-hidden="true">{{ item.note }}</span>
        <button
          class="item__remove"
          type="button"
          tabindex="-1"
          :disabled="busy"
          :aria-label="item.removeTitle"
          @click.stop="remove"
        >
          del
        </button>
      </template>
    </span>
  </li>
</template>

<style scoped>
/* see SettingsOptionRow: the same gutter and grammar, one level inside the open section */
.item {
  --row-gutter: var(--item-gutter);
  --item-gutter: calc(var(--diele-space-6) * 2);
  --row-marker-left: var(--diele-space-8);
}

.item__name {
  color: var(--diele-fg);
}

/* see ScrollingText: it owns the clipping, because it has to lift it while looping */
.item__detail {
  min-width: 0;
}

.item__confirm {
  color: var(--diele-status-down);
}

/* see AdminRowActions: revealed rather than inserted, so the trail keeps its width */
.item__remove {
  opacity: 0;
  transition:
    color var(--diele-transition),
    opacity var(--diele-transition);
}

.item:hover .item__remove,
.item:focus .item__remove {
  opacity: 1;
}

.item__remove:hover:not(:disabled) {
  color: var(--diele-status-down);
}

@media (--diele-compact) {
  .item {
    --item-gutter: var(--diele-space-4);
    --row-marker-left: var(--diele-space-2);

    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: var(--diele-space-2);
  }

  .item__name {
    grid-column: 1;
  }

  .item__trail {
    grid-row: 1;
    grid-column: 2;
  }

  .item__detail {
    grid-row: 2;
    grid-column: 1 / -1;
  }

  /* a touch pointer has no hover for the word to be revealed by */
  .item__remove {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .item,
  .item__remove {
    transition: none;
  }
}
</style>
