<script setup lang="ts">
import AdminEntryForm from '@/features/admin/AdminEntryForm.vue'
import { useStationRow } from '@/composables/useStationRow'
import type { ApiFeature } from '@diele/common'

interface AdminAddRowProps {
  feature: ApiFeature
  /** Station key, mirrored onto the element so the ring can find and focus it */
  stationKey: string
  /** Whether this row is the list's single tab stop */
  active?: boolean
  editing?: boolean
  busy?: boolean
  /** What the pending save is doing, for one that waits on a connector's own source */
  busyLabel?: string
}

const props = defineProps<AdminAddRowProps>()

const emit = defineEmits<{
  open: []
  cancel: []
  submit: [values: Record<string, unknown>]
}>()

const { attrs: stationAttrs, ownsEvent } = useStationRow({
  stationKey: () => props.stationKey,
  active: () => props.active,
  level: 2,
})

/**
 * Opens the blank form. The row is a station like any other, so adding is reached by walking
 * to the end of a feature rather than by finding a box below it.
 * @param {KeyboardEvent} event - Key press being handled
 * @returns {void}
 */
function onKeydown(event: KeyboardEvent): void {
  if (!ownsEvent(event) || event.key !== 'Enter') {
    return
  }

  event.preventDefault()
  emit('open')
}
</script>

<template>
  <li
    class="add row-shell row-marker-within row-grammar"
    v-bind="stationAttrs"
    :aria-label="`Add an entry to ${feature.label}`"
    @keydown="onKeydown"
    @click="!editing && emit('open')"
  >
    <span class="add__name truncate">add entry</span>

    <span class="add__detail truncate">{{
      editing ? '' : `a new ${feature.label.toLowerCase()} entry`
    }}</span>

    <span class="add__trail" aria-hidden="true">↵</span>

    <AdminEntryForm
      v-if="editing"
      :feature="feature"
      :busy="busy"
      :busy-label="busyLabel"
      @submit="emit('submit', $event)"
      @cancel="emit('cancel')"
    />
  </li>
</template>

<style scoped>
/* see AdminEntryRow: the same gutter, so adding sits at the depth of the entries it appends to */
/* The marker itself says what reaching this row does, rather than a `+` standing beside it all
   the time: the glyph only appears where the selection is, so one symbol in the gutter does the
   work two were doing, and the change from `~` to `+` is what says this row adds rather than
   opens. */
.add {
  --row-gutter: var(--entry-gutter);
  --entry-gutter: calc(var(--diele-space-6) * 2);
  --row-marker-left: var(--diele-space-8);
  --diele-marker: '+';

  cursor: pointer;
}

.add:hover,
.add:focus,
.add:focus-within {
  color: var(--diele-fg);
  outline: none;
}

.add :deep(.entry-form) {
  grid-column: 1 / -1;
  cursor: auto;
}

.add__trail {
  justify-self: end;
  font-size: var(--diele-text-sm);
  opacity: 0;
  transition: opacity var(--diele-transition);
}

.add:hover .add__trail,
.add:focus .add__trail {
  opacity: 1;
}

@media (max-width: 640px) {
  .add {
    --entry-gutter: var(--diele-space-4);

    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: var(--diele-space-2);
  }

  .add__detail {
    grid-row: 2;
    grid-column: 1 / -1;
  }

  .add {
    --row-marker-left: var(--diele-space-2);
  }
}

@media (prefers-reduced-motion: reduce) {
  .add,
  .add__trail {
    transition: none;
  }
}
</style>
