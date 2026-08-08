<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import ActionRow from '@/components/ActionRow.vue'
import LauncherBar from '@/components/LauncherBar.vue'
import PageFooter from '@/components/PageFooter.vue'
import PortalHeader from '@/components/PortalHeader.vue'
import SettingsOptionRow from '@/features/settings/SettingsOptionRow.vue'
import SettingsSectionRow from '@/features/settings/SettingsSectionRow.vue'
import { useConnectorEntries } from '@/composables/useConnectorEntries'
import { sortRows } from '@/composables/useEntrySort'
import { ROUTES, settingsSection } from '@/composables/routes'
import { useCollapseToStation } from '@/composables/useCollapseToStation'
import { useHashRoute } from '@/composables/useHashRoute'
import { useHiddenEntries } from '@/composables/useHiddenEntries'
import { usePortalConfig } from '@/composables/usePortalConfig'
import { useSession } from '@/composables/useSession'
import { useStationRing } from '@/composables/useStationRing'
import { useStickyFocus } from '@/composables/useStickyFocus'
import { useTheme } from '@/composables/useTheme'
import { entrySection } from '@/features/settings/entrySection'
import { searchActions } from '@/helpers/listActions'
import { settingsActions } from '@/features/settings/settingsActions'
import { settingsHintsFor } from '@/features/settings/settingsHints'
import { searchSections, type SettingsSection } from '@/features/settings/settingsSections'
import {
  buildSettingsStations,
  sectionKey,
  type SettingsStation,
} from '@/features/settings/settingsStations'
import { themeSection } from '@/features/settings/themeSection'
import { walkDelta } from '@/helpers/walkDelta'

const { brand } = usePortalConfig()
const { section: routeSection, go, replace } = useHashRoute()
const { preference, set: setTheme } = useTheme()
const { isHiddenIn, toggle, showAll } = useHiddenEntries()
const { rows: entryRows, sources } = useConnectorEntries()
const { user, signOut, signOutEverywhere } = useSession()

const query = ref('')

const bar = useTemplateRef<InstanceType<typeof LauncherBar>>('bar')
const list = useTemplateRef<HTMLElement>('list')

// A reload opens on the list, not back inside whatever was open last time. The address still
// names the open section so it can be linked to and stepped back through. Replaced rather
// than pushed, so there is no entry to go back to.
if (routeSection.value) {
  replace(ROUTES.settings)
}

// The route owns which section is open, so opening one survives a step back.
const expanded = computed(() => routeSection.value)

// Offered whenever a connector is configured, whether or not it has produced anything yet: a
// connector that is failing still has rows someone hid, and hiding the switch would strand them.
//
// This account's own list only. Keeping an entry from everyone belongs to the admin panel,
// under the connector that produced it.
const sections = computed<ReadonlyArray<SettingsSection>>(() => {
  if (sources.value.length === 0) {
    return [themeSection(preference.value, setTheme)]
  }

  return [
    themeSection(preference.value, setTheme),
    entrySection(sortRows(entryRows.value, 'name', 'asc'), {
      isHiddenIn: (ref) => isHiddenIn(ref, 'mine'),
      toggle: (ref) => toggle(ref, 'mine'),
      showAll: () => showAll('mine'),
    }),
  ]
})

const actions = computed(() =>
  settingsActions({
    leave: () => go(ROUTES.portal),
    signOut: () => void signOut(),
    signOutEverywhere: () => void signOutEverywhere(),
    name: user.value?.name ?? user.value?.email ?? null,
  }),
)

const stations = computed(() =>
  buildSettingsStations(
    searchSections(sections.value, query.value, expanded.value),
    expanded.value,
    searchActions(actions.value, query.value),
  ),
)

const {
  activeIndex,
  active,
  inList,
  focusAt,
  move: step,
  leave,
  release,
  syncTo,
} = useStationRing(stations, list, () => bar.value?.focus())

useStickyFocus({ selector: '[data-station]', heldClass: 'row-marker-held' })

const hints = computed(() =>
  settingsHintsFor(
    active.value,
    active.value?.kind === 'section' && expanded.value === active.value.section.id,
  ),
)

// The list is one tab stop, not one per row. While the field holds focus no row is active, so
// the first one takes the stop: without it Tab would step straight over the whole list.
const tabStop = computed(() => Math.max(activeIndex.value, 0))

/**
 * Opens whatever a station stands for: a section expands, an option flips, an action runs.
 * @param {SettingsStation} station - Station to open
 * @returns {void}
 */
function open(station: SettingsStation): void {
  if (station.kind === 'section') {
    const id = station.section.id
    go(expanded.value === id ? ROUTES.settings : settingsSection(id))
    return
  }

  if (station.kind === 'action') {
    if (!station.action.disabled) {
      station.action.run()
    }

    return
  }

  station.option.run()
}

/**
 * Opens the only station a term left, or steps into the list when it left several.
 * @returns {void}
 */
function submit(): void {
  const only = stations.value.length === 1 ? stations.value[0] : undefined

  focusAt(0)

  if (only) {
    open(only)
  }
}

/**
 * Walks the list and backs out of it. Escape leaves one level per press: the list, then the
 * term, then the open section, then the settings view itself.
 * @param {KeyboardEvent} event - Key press bubbling out of the field or a row
 * @returns {void}
 */
function onKeydown(event: KeyboardEvent): void {
  // a row that answered the key already marked it
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
    return
  }

  const target = event.target as HTMLElement | null
  const inSearch = Boolean(target?.closest('.launcher'))
  const delta = walkDelta(event, inSearch)

  if (delta !== 0) {
    event.preventDefault()
    step(delta)
    return
  }

  if (event.key !== 'Escape') {
    return
  }

  const station = active.value

  // An open section is a level of its own: from inside one, Escape closes it and lands on the
  // row it belongs to, rather than stepping out to the field and leaving the section open
  // behind it with nowhere obvious to go back to.
  //
  // Where the key came from decides which level this is, rather than the ring's index: a
  // pointer that clicked into the field leaves the index on whatever row it was last on, and
  // reading that would collapse a section from a caret sitting in the search box.
  if (!inSearch && inList.value && station) {
    const parent =
      station.kind === 'section'
        ? expanded.value === station.section.id
          ? station.section
          : undefined
        : station.section

    if (parent) {
      collapseTo(parent.id)
      return
    }

    leave()
    return
  }

  if (query.value) {
    query.value = ''
    return
  }

  go(expanded.value ? '/settings' : '/')
}

const collapseTo = useCollapseToStation(stations, focusAt, sectionKey, () => {
  go(ROUTES.settings)
})

/**
 * Adopts the station the caret landed on, so clicking a row and arrowing to it leave the ring
 * in the same place, and lets the ring go when it landed anywhere else.
 * @param {FocusEvent} event - Focus landing anywhere in the view
 * @returns {void}
 */
function onFocusin(event: FocusEvent): void {
  const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-station]')

  if (row?.dataset.station) {
    syncTo(row.dataset.station)
    return
  }

  release()
}
</script>

<template>
  <div class="settings view-shell" @keydown="onKeydown" @focusin="onFocusin">
    <PortalHeader :title="brand.title" subtitle="settings" />

    <LauncherBar
      ref="bar"
      v-model="query"
      :match-count="stations.length"
      :active-name="active?.label"
      :has-selection="inList"
      placeholder="Search settings"
      :hints="hints"
      @submit="submit"
    />

    <main class="settings__body">
      <ul
        v-if="stations.length"
        ref="list"
        class="settings__list row-tracks"
        role="tree"
        aria-label="Settings"
      >
        <template v-for="(station, index) in stations" :key="station.key">
          <SettingsSectionRow
            v-if="station.kind === 'section'"
            :section="station.section"
            :station-key="station.key"
            :expanded="expanded === station.section.id"
            :active="index === tabStop"
            :focused="index === activeIndex"
            :query="query"
            @open="open(station)"
          />

          <SettingsOptionRow
            v-else-if="station.kind === 'option'"
            :option="station.option"
            :station-key="station.key"
            :active="index === tabStop"
            :focused="index === activeIndex"
            :query="query"
            @run="open(station)"
          />

          <ActionRow
            v-else
            :action="station.action"
            :station-key="station.key"
            :active="index === tabStop"
            :focused="index === activeIndex"
            :query="query"
            :nested="station.nested"
            @run="open(station)"
          />
        </template>
      </ul>

      <p v-else class="settings__empty">Nothing here matches “{{ query }}”.</p>
    </main>

    <PageFooter />
  </div>
</template>

<style scoped>
.settings__body {
  width: 100%;
  max-width: 720px;
}

@media (max-width: 640px) {
  .settings__list {
    display: block;
  }
}

.settings__list {
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
  border-bottom: 3px solid var(--diele-rule);
}

/* Written here rather than on each row, because the rows are of three kinds and a sibling
   selector inside any one of them cannot see the other two. */
.settings__list > li + li {
  border-top: 1px solid var(--diele-rule);
}

.settings__empty {
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-lg);
  color: var(--diele-fg-muted);
}
</style>
