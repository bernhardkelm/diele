<script setup lang="ts">
import { computed } from 'vue'
import AlertDot from '@/components/AlertDot.vue'
import { formatRelativeTime } from '@/helpers/relativeTime'
import type { ApiSignal } from '@diele/common'

interface AlertRowProps {
  signal: ApiSignal
  /** Whether silencing takes the line off the whole portal rather than this account's */
  forEveryone?: boolean
  /** Whether this line is already quietened, and so drawn as the list's held-back half */
  silenced?: boolean
  /** Whether whoever is looking may bring it back, false where the other scope quietened it */
  restorable?: boolean
}

const props = defineProps<AlertRowProps>()
const emit = defineEmits<{ toggle: [] }>()

const since = computed(() =>
  props.signal.since ? formatRelativeTime(props.signal.since) : undefined,
)

// Only the scope that owns a silence may lift it, so a line quietened in the other one carries no
// way back rather than a control that would quietly do nothing.
const actionable = computed(() => !props.silenced || props.restorable === true)

const action = computed(() => (props.silenced ? 'restore' : 'silence'))

const actionLabel = computed(() => {
  if (props.silenced) {
    return props.forEveryone
      ? `Bring ${props.signal.label} back for everyone`
      : `Bring ${props.signal.label} back`
  }

  return props.forEveryone
    ? `Silence ${props.signal.label} for everyone until it clears`
    : `Silence ${props.signal.label} until it clears`
})

// Said rather than shown, the trail word being a glyph to assistive technology: this line is
// quietened by a choice this account cannot unmake.
const heldLabel = computed(() => `${props.signal.label}, silenced for the whole portal`)
</script>

<template>
  <!-- Laid out like a connector row: the name takes what is left, what you can do to it appears
       between, and the time ends on the section's right edge where every other list puts it. -->
  <li class="alert" :class="{ 'alert--silenced': silenced }">
    <!-- A link only where the source said where it shows this in full. The detail is an admin's,
         the link is not: anyone who can see that something is firing can go and read it. -->
    <component
      :is="signal.href ? 'a' : 'span'"
      class="alert__main"
      data-alert-step
      :href="signal.href"
      :rel="signal.href ? 'noopener' : undefined"
      :tabindex="signal.href ? undefined : 0"
      :title="signal.detail"
    >
      <AlertDot :severity="signal.severity" />
      <!-- The dot carries the severity in colour alone, so the word itself is read out here -->
      <span class="alert__sr">{{ signal.severity }}:</span>
      <span class="alert__name truncate">{{ signal.label }}</span>
      <span v-if="signal.detail" class="alert__detail truncate">{{ signal.detail }}</span>
    </component>

    <!-- Quietens it here and not in the source: nothing about this reaches whatever raised it,
         and the line comes back on its own if the condition clears and fires again. -->
    <span class="alert__actions" :class="{ 'alert__actions--shown': !actionable }">
      <button v-if="actionable" class="alert__silence" :title="actionLabel" @click="emit('toggle')">
        <span aria-hidden="true">{{ action }}</span>
        <span class="alert__sr">{{ actionLabel }}</span>
      </button>

      <span v-else class="alert__held" :title="heldLabel">
        <span aria-hidden="true">portal</span>
        <span class="alert__sr">{{ heldLabel }}</span>
      </span>
    </span>

    <span class="alert__activity">{{ since }}</span>
  </li>
</template>

<style scoped>
.alert {
  display: flex;
  align-items: baseline;
  gap: var(--diele-space-4);
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-sm);
}

.alert__main {
  display: flex;
  align-items: baseline;
  gap: var(--diele-space-2);
  flex: 1;
  min-width: 0;
  padding: var(--diele-space-2) 0;
  color: var(--diele-fg-muted);
  transition: color var(--diele-transition);
}

a.alert__main:hover,
.alert__main:focus-visible {
  color: var(--diele-fg);
  outline: none;
}

a.alert__main:hover .alert__name,
.alert__main:focus-visible .alert__name {
  text-decoration: underline;
}

/* the dot is inline-block and sits on the text baseline, so it is nudged onto the optical centre */
.alert__main :deep(.alert-dot) {
  transform: translateY(-1px);
}

.alert__name {
  flex: none;
  color: var(--diele-fg);
  font-weight: 600;
}

/* Absent for everyone but an admin, so the row is the name alone rather than a gap where a
   description would be. It takes the shrinking, since the name is the part that must survive. */
.alert__detail {
  min-width: 0;
}

/* see EntryRow: what you can do to a row appears on hover, and stays put where a pointer cannot
   hover at all */
.alert__actions {
  display: flex;
  flex: none;
  justify-content: flex-end;
  color: var(--diele-fg-muted);
  opacity: 0;
  transition: opacity var(--diele-transition);
}

.alert:hover .alert__actions,
.alert:focus-within .alert__actions {
  opacity: 1;
}

@media (hover: none) {
  .alert__actions {
    opacity: 1;
  }
}

/* last in the row and fixed, so the times end on the section's right edge the way the connector
   rows' do, rather than wherever the text before them happened to stop */
.alert__activity {
  flex: none;
  width: 5rem;
  text-align: right;
  color: var(--diele-fg-muted);
  transition: color var(--diele-transition);
}

.alert:hover .alert__activity {
  color: var(--diele-fg);
}

/* Quietened lines are the list's held-back half, so they read as present rather than as current:
   the name loses its weight and the whole row sits back a step. */
.alert--silenced .alert__name {
  font-weight: 400;
  color: var(--diele-fg-muted);
}

.alert--silenced .alert__main {
  opacity: 0.7;
}

/* Stays put rather than appearing on hover: the marker is not something you can press, so a
   reader hunting for the control has to see there is none without going looking. Set on the
   container, since opacity on the child cannot undo it. */
.alert__actions--shown {
  opacity: 1;
}

.alert__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
