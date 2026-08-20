<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import AlertDot from '@/components/AlertDot.vue'
import AlertRow from '@/features/portal/AlertRow.vue'
import type { ApiSignal } from '@diele/common'

interface AlertListProps {
  /** What is firing, worst first, as the API ordered it */
  signals: ReadonlyArray<ApiSignal>
  /** Whether silencing takes a line off the whole portal rather than this account's */
  forEveryone?: boolean
}

const props = defineProps<AlertListProps>()
const emit = defineEmits<{ silence: [id: string] }>()

const expanded = ref(false)
const root = useTemplateRef<HTMLElement>('root')

// The server orders these, so the worst is simply the first. Reading it rather than re-ranking
// here keeps one place deciding what "worst" means.
const worst = computed(() => props.signals[0]?.severity ?? 'warning')

// A single alert is shown outright rather than collapsed behind a count of one
const only = computed(() => (props.signals.length === 1 ? props.signals[0] : undefined))

// One alert is its own line, so the summary is only ever drawn for several. Collapsed again once
// they clear, so a portal that opens quiet does not inherit an expansion from an hour ago.
watch(
  () => props.signals.length,
  (count) => {
    if (count <= 1) {
      expanded.value = false
    }
  },
)

/**
 * Steps focus between the lines this region holds.
 *
 * Arrows only, deliberately: Tab is how the caret gets out of here and into the search field,
 * and reading it as a step the way the settings list does would shut the region around anyone
 * who arrived by keyboard.
 * @param {KeyboardEvent} event - Key press bubbling out of a line
 * @returns {void}
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
    return
  }

  const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
  if (delta === 0) {
    return
  }

  const steps = [...(root.value?.querySelectorAll<HTMLElement>('[data-alert-step]') ?? [])]
  const from = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-alert-step]')
  const next = from ? steps[steps.indexOf(from) + delta] : steps[0]

  // Nothing above the first line or below the last: the arrows walk this region rather than
  // wrapping inside it, so a press that runs out of rows leaves the focus where it was.
  if (!next) {
    return
  }

  event.preventDefault()
  next.focus()
}
</script>

<template>
  <!-- Polite rather than an alert role: this is a new tab page and the line is on screen before
       anything is typed, so something starting to fire while it is open is worth saying and not
       worth interrupting for. -->
  <section
    v-if="signals.length"
    ref="root"
    class="alerts"
    role="status"
    aria-label="Alerts"
    @keydown="onKeydown"
  >
    <ul v-if="only" class="alerts__list">
      <AlertRow :signal="only" :for-everyone="forEveryone" @silence="emit('silence', only.id)" />
    </ul>

    <template v-else>
      <button
        class="alerts__summary"
        data-alert-step
        :aria-expanded="expanded"
        aria-controls="alert-list"
        @click="expanded = !expanded"
      >
        <AlertDot :severity="worst" />
        <span>{{ signals.length }} alerts firing</span>
        <!-- Beside what it opens rather than pushed to the edge: the right edge is where the
             times line up, and this is the group's own control rather than one row's. -->
        <span class="alerts__caret" aria-hidden="true">{{ expanded ? '▾' : '▸' }}</span>
      </button>

      <ul v-show="expanded" id="alert-list" class="alerts__list">
        <AlertRow
          v-for="signal in signals"
          :key="signal.id"
          :signal="signal"
          :for-everyone="forEveryone"
          @silence="emit('silence', signal.id)"
        />
      </ul>
    </template>
  </section>
</template>

<style scoped>
.alerts {
  width: 100%;
  max-width: var(--diele-content-width);
  border-bottom: 3px solid var(--diele-rule);
}

.alerts__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.alerts__list > li + li {
  border-top: 1px solid var(--diele-rule);
}

/* The same line the single alert draws, so collapsing several changes what the line says and
   not what it looks like. */
.alerts__summary {
  display: flex;
  align-items: baseline;
  gap: var(--diele-space-2);
  width: 100%;
  padding: var(--diele-space-2) 0;
  font-size: var(--diele-text-sm);
  text-align: left;
}

.alerts__summary :deep(.alert-dot) {
  transform: translateY(-1px);
}

.alerts__caret {
  color: var(--diele-fg-muted);
}
</style>
