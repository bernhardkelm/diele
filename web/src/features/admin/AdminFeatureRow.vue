<script setup lang="ts">
import { computed } from 'vue'
import AdminRowActions from '@/features/admin/AdminRowActions.vue'
import HighlightedText from '@/components/HighlightedText.vue'
import ScrollingText from '@/components/ScrollingText.vue'
import LoadingDots from '@/components/LoadingDots.vue'
import { useStationRow } from '@/composables/useStationRow'
import type { RowAction, RowActionId } from '@/features/admin/adminRowActions'
import type { ApiFeature } from '@diele/common'

interface AdminFeatureRowProps {
  feature: ApiFeature
  /** Station key, mirrored onto the element so the ring can find and focus it */
  stationKey: string
  expanded?: boolean
  /** Whether this row is the list's single tab stop */
  active?: boolean
  /** Whether this row actually holds focus, which is what reads its line out */
  focused?: boolean
  /** Term filtering the list, marked up in the label */
  query?: string
  busy?: boolean
  /** Whether this feature's rows are being reloaded behind the ones already on screen */
  refreshing?: boolean
  /** Whether it sits inside another feature's rows rather than in the top-level list */
  nested?: boolean
  actions: ReadonlyArray<RowAction>
  /** Index the left and right keys selected, 0 being the row itself */
  activeAction?: number
}

const props = defineProps<AdminFeatureRowProps>()

const emit = defineEmits<{ run: [id: RowActionId] }>()

// Read once: a station's depth is fixed by its key, and the list keys each row by that.
const { attrs: stationAttrs, ownsEvent } = useStationRow({
  stationKey: () => props.stationKey,
  active: () => props.active,
  level: props.nested ? 2 : 1,
})

const off = computed(() => Boolean(props.feature.toggleable) && !props.feature.enabled)

// `soon` is a promise, so only a feature with no code behind it may make it. One that is built
// and merely waiting on a value the deployment has not set is `blocked`: there is nothing to
// wait for, and the detail beside it says what to set.
const unavailableBadge = computed(() =>
  props.feature.unavailableReason === 'blocked' ? 'blocked' : 'soon',
)

// A feature that is off says why here rather than in a panel of its own, so turning it off
// costs the row no more height than leaving it on.
const detail = computed(() => {
  if (props.feature.unavailable) {
    return props.feature.unavailable
  }

  if (off.value && props.feature.toggleHint) {
    return props.feature.toggleHint
  }

  return props.feature.description
})

/**
 * Runs the row's key map: opening and closing the feature, and turning the whole of it on
 * or off. Keys are only read when the row itself is the target.
 * @param {KeyboardEvent} event - Key press being handled
 * @returns {void}
 */
function onKeydown(event: KeyboardEvent): void {
  const bare = !event.metaKey && !event.ctrlKey && !event.altKey
  if (!ownsEvent(event) || !bare || props.feature.unavailable) {
    return
  }

  // Enter runs whatever the left and right keys selected, which is opening the feature until
  // they have been used.
  if (event.key === 'Enter') {
    event.preventDefault()
    const selected = props.actions[props.activeAction ?? 0]

    if (selected && !selected.disabled) {
      emit('run', selected.id)
    }

    return
  }

  if (event.key === 'd' && props.feature.toggleable && !props.busy) {
    event.preventDefault()
    emit('run', 'toggle')
  }
}
</script>

<template>
  <li
    class="feature row-shell row-marker-focus row-grammar"
    v-bind="stationAttrs"
    :class="{ 'feature--off': off, 'feature--nested': nested }"
    :aria-expanded="feature.unavailable || feature.switchOnly ? undefined : expanded"
    :aria-disabled="feature.unavailable ? true : undefined"
    @keydown="onKeydown"
    @click="!feature.unavailable && emit('run', actions[0]?.id ?? 'open')"
  >
    <span class="feature__name truncate">
      <HighlightedText :text="feature.label" :query="query" />
      <span class="feature__kind">{{ feature.kind }}</span>
    </span>

    <ScrollingText class="feature__hint" :text="detail" :focused="focused" />

    <span class="feature__trail row-trail">
      <span v-if="feature.unavailable" class="feature__soon">{{ unavailableBadge }}</span>

      <template v-else>
        <span class="feature__switch">
          <AdminRowActions
            :actions="actions"
            :active-action="activeAction"
            :name="feature.label"
            :busy="busy"
            @run="emit('run', $event)"
          />
        </span>

        <!-- a switch owns no rows, so it has neither a count to show nor anything to open -->
        <template v-if="!feature.switchOnly">
          <!-- in place of the counts, so a reload costs the trail no width and moves nothing -->
          <LoadingDots v-if="refreshing" class="feature__count" title="Reloading" />

          <span v-else class="feature__count" aria-hidden="true">
            {{ feature.enabledCount }}/{{ feature.count }}
          </span>
          <span class="feature__chevron" aria-hidden="true">{{ expanded ? '▾' : '▸' }}</span>
        </template>
      </template>
    </span>
  </li>
</template>

<style scoped>
/* see base.css .row-shell and .row-grammar: this row is entirely the shared shell, and adds
   only the state below */
.feature[aria-disabled='true'] {
  cursor: default;
}

/* see AdminEntryRow .entry: a feature configured inside another one sits at the depth of that
   one's rows, so the two read as one list rather than as a heading among entries */
.feature--nested {
  --row-gutter: calc(var(--diele-space-6) * 2);
  --row-marker-left: var(--diele-space-8);
}

/* see ScrollingText: it owns the clipping, because it has to lift it while looping */
.feature__hint {
  min-width: 0;
}

.feature__name {
  display: flex;
  gap: var(--diele-space-2);
  align-items: baseline;
  color: var(--diele-fg);
}

.feature__kind {
  font-size: var(--diele-text-2xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--diele-fg-muted);
}

.feature__soon {
  color: var(--diele-status-pending);
}

/* see AdminEntryRow: a feature that is off reads the same way one of its rows would */
.feature--off {
  opacity: 0.55;
}

/* see AdminRowActions: the words hide themselves, the row is what brings them out */
.feature:hover :deep(.actions__item),
.feature:focus :deep(.actions__item) {
  opacity: 1;
}

@media (--diele-compact) {
  .feature {
    --row-marker-left: 0;

    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: var(--diele-space-2);
    padding-left: var(--diele-space-3);
  }

  .feature__name {
    grid-column: 1;
  }

  .feature__trail {
    grid-row: 1;
    grid-column: 2;
  }

  .feature__hint {
    grid-row: 2;
    grid-column: 1 / -1;
  }

  /* a touch pointer has no hover for the switch to be revealed by */
  .feature :deep(.actions__item) {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .feature {
    transition: none;
  }
}
</style>
