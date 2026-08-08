<script setup lang="ts">
import { computed, ref } from 'vue'
import AdminEntryForm from '@/features/admin/AdminEntryForm.vue'
import AdminRowActions from '@/features/admin/AdminRowActions.vue'
import LoadingDots from '@/components/LoadingDots.vue'
import ScrollingText from '@/components/ScrollingText.vue'
import { useStationRow } from '@/composables/useStationRow'
import type { RowAction, RowActionId } from '@/features/admin/adminRowActions'
import { detailOf, summaryOf } from '@/features/admin/adminRowText'
import type { ApiFeature, ApiRow } from '@diele/common'

interface AdminEntryRowProps {
  feature: ApiFeature
  row: ApiRow
  /** Station key, mirrored onto the element so the ring can find and focus it */
  stationKey: string
  /** Whether this row is the list's single tab stop */
  active?: boolean
  /** Whether this row actually holds focus, which is what reads its line out */
  focused?: boolean
  editing?: boolean
  busy?: boolean
  /** What a row action is doing, shown on the row's own line while it runs */
  working?: string
  /** What a save from this row's form is doing, shown inside the form */
  busyLabel?: string
  actions: ReadonlyArray<RowAction>
  /** Index the left and right keys selected, 0 being the row itself */
  activeAction?: number
}

const props = defineProps<AdminEntryRowProps>()

const emit = defineEmits<{
  run: [id: RowActionId]
  cancel: []
  submit: [values: Record<string, unknown>]
}>()

const { attrs: stationAttrs, ownsEvent } = useStationRow({
  stationKey: () => props.stationKey,
  active: () => props.active,
  level: 2,
})

// Deleting is the one action with nothing to undo it, so the key asks twice. Held on the row
// rather than in a dialog, because a confirmation that has to be reached for with the mouse
// would undo the point of driving the list from the keyboard.
const confirming = ref(false)

const name = computed(() => summaryOf(props.row))
const label = computed(() => (props.row.enabled === false ? `${name.value}, off` : name.value))

/**
 * Runs the row's own key map: opening the form, toggling, reordering and deleting. Keys are
 * only read when the row itself is the target, which is what keeps a `d` typed into a text
 * field from disabling the row that field belongs to.
 * @param {KeyboardEvent} event - Key press being handled
 * @returns {void}
 */
function onKeydown(event: KeyboardEvent): void {
  if (!ownsEvent(event) || props.busy) {
    return
  }

  const alt = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey

  if (alt && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault()
    const id = event.key === 'ArrowUp' ? 'up' : 'down'

    // reordering off either end would still cost a write and a reload to answer with the
    // list it already has
    if (!props.actions.find((action) => action.id === id)?.disabled) {
      run(id)
    }

    return
  }

  if (props.row.readonly || event.metaKey || event.ctrlKey || event.altKey) {
    return
  }

  if (event.key === 'x' || event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    run('remove')
    return
  }

  // Enter runs whatever the left and right keys selected, which is the row's own default
  // until they have been used.
  if (event.key === 'Enter') {
    event.preventDefault()
    const selected = props.actions[props.activeAction ?? 0]

    if (selected && !selected.disabled) {
      run(selected.id)
    }

    return
  }

  if (event.key === 'e') {
    event.preventDefault()
    run('edit')
    return
  }

  if (event.key === 'd') {
    event.preventDefault()
    run('toggle')
  }
}

/**
 * Passes an action up, arming a delete on its first request and carrying it out on the second.
 * Every route into deleting goes through here, so the trail word asks the same question the
 * key does.
 * @param {RowActionId} id - Action being run
 * @returns {void}
 */
function run(id: RowActionId): void {
  if (id !== 'remove') {
    confirming.value = false
    emit('run', id)
    return
  }

  if (!confirming.value) {
    confirming.value = true
    return
  }

  confirming.value = false
  emit('run', 'remove')
}

/**
 * Disarms a pending delete once the row stops holding focus, so it cannot be completed later
 * by a keystroke aimed at something else.
 * @param {FocusEvent} event - Focus leaving the row or something inside it
 * @returns {void}
 */
function onFocusout(event: FocusEvent): void {
  const next = event.relatedTarget
  const row = event.currentTarget as HTMLElement

  if (next instanceof Node && row.contains(next)) {
    return
  }

  confirming.value = false
}
</script>

<template>
  <li
    class="entry row-shell row-marker-within row-grammar"
    v-bind="stationAttrs"
    :class="{ 'entry--off': row.enabled === false }"
    :aria-label="label"
    @keydown="onKeydown"
    @focusout="onFocusout"
    @click="!editing && !row.readonly && run('edit')"
  >
    <span class="entry__name truncate">{{ name }}</span>

    <span v-if="working" class="entry__working" role="status">{{ working }}<LoadingDots /></span>

    <ScrollingText v-else class="entry__detail" :text="detailOf(row)" :focused="focused" />

    <span class="entry__trail row-trail">
      <span v-if="row.readonly" class="entry__builtin">built in</span>

      <span v-else-if="confirming" class="entry__confirm" role="status">
        press again to delete
      </span>

      <span v-else class="entry__actions">
        <AdminRowActions
          :actions="actions"
          :active-action="activeAction"
          :name="name"
          :busy="busy"
          @run="run"
        />
      </span>
    </span>

    <AdminEntryForm
      v-if="editing"
      :feature="feature"
      :row="row"
      :busy="busy"
      :busy-label="busyLabel"
      @submit="emit('submit', $event)"
      @cancel="emit('cancel')"
    />
  </li>
</template>

<style scoped>
/* label · detail · trail on the shared tracks, the same grammar every result row uses. The
   gutter is one step deeper than a feature's, derived from it so both levels keep the same
   distance between the marker and the text. */
.entry {
  --row-gutter: var(--entry-gutter);
  --entry-gutter: calc(var(--diele-space-6) * 2);
  --row-marker-left: var(--diele-space-8);
}

.entry:hover,
.entry:focus,
.entry:focus-within {
  color: var(--diele-fg);
  outline: none;
}

.entry--off {
  opacity: 0.55;
}

/* the form is prose rather than a row, so it spans the tracks instead of joining them */
.entry :deep(.entry-form) {
  grid-column: 1 / -1;
}

/* see ScrollingText: it owns the clipping, because it has to lift it while looping */
.entry__detail {
  min-width: 0;
}

/* takes the detail's place rather than sitting beside it: the row is one line, and the thing
   happening to it is more use there than the state it had a moment ago */
.entry__working {
  min-width: 0;
  color: var(--diele-accent);
}

.entry__name {
  color: var(--diele-fg);
}

.entry__builtin {
  font-size: var(--diele-text-2xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.entry__confirm {
  color: var(--diele-status-down);
}

.entry__actions {
  display: flex;
  gap: var(--diele-space-2);
  align-items: baseline;
}

/* see AdminRowActions: the words hide themselves, the row is what brings them out */
.entry:hover :deep(.actions__item),
.entry:focus-within :deep(.actions__item) {
  opacity: 1;
}

@media (max-width: 640px) {
  .entry {
    --entry-gutter: var(--diele-space-4);

    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: var(--diele-space-2);
  }

  .entry__name {
    grid-column: 1;
  }

  .entry__trail {
    grid-row: 1;
    grid-column: 2;
  }

  .entry__detail {
    grid-row: 2;
    grid-column: 1 / -1;
  }

  .entry {
    --row-marker-left: var(--diele-space-2);
  }

  /* a touch pointer has no hover for the actions to be revealed by */
  .entry :deep(.actions__item) {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .entry,
  .entry__actions {
    transition: none;
  }
}
</style>
