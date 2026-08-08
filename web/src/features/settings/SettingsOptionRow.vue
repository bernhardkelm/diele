<script setup lang="ts">
import { computed } from 'vue'
import HighlightedText from '@/components/HighlightedText.vue'
import ScrollingText from '@/components/ScrollingText.vue'
import { useStationRow } from '@/composables/useStationRow'
import type { SettingsOption } from '@/features/settings/settingsSections'

interface SettingsOptionRowProps {
  option: SettingsOption
  /** Station key, mirrored onto the element so the ring can find and focus it */
  stationKey: string
  /** Whether this row is the list's single tab stop */
  active?: boolean
  /** Whether this row actually holds focus, which is what reads its line out */
  focused?: boolean
  /** Term filtering the list, marked up in the label */
  query?: string
}

const props = defineProps<SettingsOptionRowProps>()

const emit = defineEmits<{ run: [] }>()

const { attrs: stationAttrs, ownsEvent } = useStationRow({
  stationKey: () => props.stationKey,
  active: () => props.active,
  level: 2,
})

// the trail word is a glyph as far as assistive technology is concerned, so the state is said
// here instead, the way an admin row says it is off
const label = computed(() => `${props.option.label}, ${props.option.on ? 'on' : 'off'}`)

/**
 * Flips the setting. `d` as well as Enter, so the key means the same thing it does on an admin
 * row, and only when the row itself is the target.
 * @param {KeyboardEvent} event - Key press being handled
 * @returns {void}
 */
function onKeydown(event: KeyboardEvent): void {
  const bare = !event.metaKey && !event.ctrlKey && !event.altKey
  if (!ownsEvent(event) || !bare || (event.key !== 'Enter' && event.key !== 'd')) {
    return
  }

  event.preventDefault()
  emit('run')
}
</script>

<template>
  <li
    class="option row-shell row-marker-focus row-grammar"
    v-bind="stationAttrs"
    :class="{ 'option--off': !option.on }"
    :aria-label="label"
    @keydown="onKeydown"
    @click="emit('run')"
  >
    <span class="option__name truncate">
      <HighlightedText :text="option.label" :query="query" />
    </span>

    <ScrollingText class="option__detail" :text="option.detail" :focused="focused" />

    <span class="option__trail row-trail" aria-hidden="true">
      <span class="option__switch" :class="{ 'option__switch--off': !option.on }">
        {{ option.on ? 'on' : 'off' }}
      </span>
    </span>
  </li>
</template>

<style scoped>
/* see AdminEntryRow: a row inside an open section carries the same gutter and grammar, so both
   lists nest the same way */
.option {
  --row-gutter: var(--option-gutter);
  --option-gutter: calc(var(--diele-space-6) * 2);
  --row-marker-left: var(--diele-space-8);
  cursor: pointer;
}

.option--off {
  opacity: 0.55;
}

.option__name {
  color: var(--diele-fg);
}

/* see ScrollingText: it owns the clipping, because it has to lift it while looping */
.option__detail {
  min-width: 0;
}

/* see AdminRowActions: the word is the state the row is in, and the off one keeps the colour
   the off badges have always used, so a glance down the list says which rows are dormant */
.option__switch--off {
  color: var(--diele-status-pending);
}

@media (--diele-compact) {
  .option {
    --option-gutter: var(--diele-space-4);
    --row-marker-left: var(--diele-space-2);

    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: var(--diele-space-2);
  }

  .option__name {
    grid-column: 1;
  }

  .option__trail {
    grid-row: 1;
    grid-column: 2;
  }

  .option__detail {
    grid-row: 2;
    grid-column: 1 / -1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .option {
    transition: none;
  }
}
</style>
