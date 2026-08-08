<script setup lang="ts">
import HighlightedText from '@/components/HighlightedText.vue'
import ScrollingText from '@/components/ScrollingText.vue'
import { useStationRow } from '@/composables/useStationRow'
import type { SettingsSection } from '@/features/settings/settingsSections'

interface SettingsSectionRowProps {
  section: SettingsSection
  /** Station key, mirrored onto the element so the ring can find and focus it */
  stationKey: string
  expanded?: boolean
  /** Whether this row is the list's single tab stop */
  active?: boolean
  /** Whether this row actually holds focus, which is what reads its line out */
  focused?: boolean
  /** Term filtering the list, marked up in the label */
  query?: string
}

const props = defineProps<SettingsSectionRowProps>()

const emit = defineEmits<{ open: [] }>()

const { attrs: stationAttrs, ownsEvent } = useStationRow({
  stationKey: () => props.stationKey,
  active: () => props.active,
  level: 1,
})

/**
 * Opens the section, or closes it when it is already open.
 * @param {KeyboardEvent} event - Key press being handled
 * @returns {void}
 */
function onKeydown(event: KeyboardEvent): void {
  const bare = !event.metaKey && !event.ctrlKey && !event.altKey
  if (!ownsEvent(event) || !bare || event.key !== 'Enter') {
    return
  }

  event.preventDefault()
  emit('open')
}
</script>

<template>
  <li
    class="section row-shell row-marker-focus row-grammar"
    v-bind="stationAttrs"
    :aria-expanded="expanded"
    @keydown="onKeydown"
    @click="emit('open')"
  >
    <span class="section__name truncate">
      <HighlightedText :text="section.label" :query="query" />
    </span>

    <ScrollingText class="section__hint" :text="section.description" :focused="focused" />

    <span class="section__trail row-trail" aria-hidden="true">
      <span class="section__state">{{ section.trail }}</span>
      <span class="section__chevron">{{ expanded ? '▾' : '▸' }}</span>
    </span>
  </li>
</template>

<style scoped>
/* see base.css .row-grammar: label · detail · trail on the shared tracks, the same grammar an
   admin feature row uses, because these two lists are read the same way */
.section {
  cursor: pointer;
}

.section__name {
  color: var(--diele-fg);
}

/* see ScrollingText: it owns the clipping, because it has to lift it while looping */
.section__hint {
  min-width: 0;
}

@media (max-width: 640px) {
  .section {
    --row-marker-left: 0;

    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: var(--diele-space-2);
    padding-left: var(--diele-space-3);
  }

  .section__name {
    grid-column: 1;
  }

  .section__trail {
    grid-row: 1;
    grid-column: 2;
  }

  .section__hint {
    grid-row: 2;
    grid-column: 1 / -1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .section {
    transition: none;
  }
}
</style>
