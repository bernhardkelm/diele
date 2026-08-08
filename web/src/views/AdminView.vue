<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import ActionRow from '@/components/ActionRow.vue'
import AdminAddRow from '@/features/admin/AdminAddRow.vue'
import AdminEntryRow from '@/features/admin/AdminEntryRow.vue'
import AdminFeatureRow from '@/features/admin/AdminFeatureRow.vue'
import CredentialForm from '@/components/CredentialForm.vue'
import LauncherBar from '@/components/LauncherBar.vue'
import PortalHeader from '@/components/PortalHeader.vue'
import { useAdmin } from '@/features/admin/useAdmin'
import { useAdminKeyboard } from '@/features/admin/useAdminKeyboard'
import { useStationRing } from '@/composables/useStationRing'
import { useAdminRowEdits } from '@/features/admin/useAdminRowEdits'
import { useAdminTransfer } from '@/features/admin/useAdminTransfer'
import { ROUTES, adminSection } from '@/composables/routes'
import { useCollapseToStation } from '@/composables/useCollapseToStation'
import { useHashRoute } from '@/composables/useHashRoute'
import { usePortalConfig } from '@/composables/usePortalConfig'
import { useSession } from '@/composables/useSession'
import { searchActions, type ListAction } from '@/helpers/listActions'
import { hintsFor } from '@/features/admin/adminHints'
import { rowActionsFor, type RowActionId } from '@/features/admin/adminRowActions'
import { adminSettingsActions } from '@/features/admin/adminSettingsActions'
import { buildStations, featureKey, type AdminStation } from '@/features/admin/adminStations'
import { searchFeatures } from '@/features/admin/featureSearch'

const { brand } = usePortalConfig()
const { section: routeFeature, go, replace } = useHashRoute()
const { signIn, mode } = useSession()
const {
  features,
  rows,
  expanded,
  error,
  needsAuth,
  forbidden,
  busy,
  busyLabel,
  refreshing,
  loadFeatures,
  reload,
  expand,
  create,
  update,
  setEnabled,
  setFeatureEnabled,
  remove,
  move,
  sync,
} = useAdmin()

const query = ref('')

const file = useTemplateRef<HTMLInputElement>('file')
const bar = useTemplateRef<InstanceType<typeof LauncherBar>>('bar')
const list = useTemplateRef<HTMLElement>('list')

const {
  busy: transferBusy,
  message,
  failed,
  exportSettings,
  importSettings,
} = useAdminTransfer(() => void reload())

const actions = computed<ReadonlyArray<ListAction>>(() =>
  adminSettingsActions({
    exportSettings: () => void exportSettings(),
    pickImportFile: () => file.value?.click(),
    leave: () => go(ROUTES.portal),
    busy: transferBusy.value,
    message: failed.value ? undefined : message.value,
  }),
)

const stations = computed(() =>
  buildStations(
    searchFeatures(features.value, query.value),
    expanded.value,
    rows.value,
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
  syncTo,
  restore,
} = useStationRing(stations, list, () => bar.value?.focus())

const { activeAction, walkDelta, openPicker, stepInForm, moveAction } = useAdminKeyboard({
  active: () => active.value,
  step,
  leave,
})

// Every write reloads the rows, so the element that held focus is gone when the call resolves;
// these pair each write with where the caret should land afterwards.
// Station whose action is running, so only that row says what is happening rather than all of
// them greying out together.
const acting = ref<string | undefined>()

const { editing, keepFocus, removeAt, cancelEdit, saveEntry, addEntry } = useAdminRowEdits({
  create,
  update,
  remove,
  restore,
})

const hints = computed(() =>
  hintsFor(
    active.value,
    rowActionsFor(active.value),
    active.value?.kind === 'feature' && expanded.value === active.value.feature.id,
    active.value?.kind === 'feature' && Boolean(active.value.feature.switchOnly),
  ),
)

// The selection belongs to the row it was made on, so stepping to another one starts over.
watch(activeIndex, () => {
  activeAction.value = 0
})

// The list is one tab stop, not one per row. While the field holds focus no row is active, so
// the first one takes the stop: without it Tab would step straight over the whole list.
const tabStop = computed(() => Math.max(activeIndex.value, 0))

// A reload opens on the list, not back inside whatever was expanded last time. The address
// still names the open feature so it can be linked to and stepped back through, but reopening
// it on load would restore a panel nobody asked for this visit. Replaced rather than pushed,
// and before the watch below, so there is no entry to go back to and nothing expands first.
if (routeFeature.value) {
  replace(ROUTES.admin)
}

// The route owns which feature is open from here on, so opening one survives a step back.
watch(routeFeature, (id) => void expand(id), { immediate: true })

// A form belongs to the feature it was opened in, and that feature is no longer on screen.
watch(expanded, () => {
  editing.value = undefined
})

/**
 * Opens whatever a station stands for: a feature expands, a row or the add line opens its
 * form, an action runs.
 * @param {AdminStation} station - Station to open
 * @returns {void}
 */
function open(station: AdminStation): void {
  if (station.kind === 'feature') {
    const id = station.feature.id
    const shut = station.feature.unavailable || station.feature.switchOnly || expanded.value === id

    go(shut ? ROUTES.admin : adminSection(id))
    return
  }

  if (station.kind === 'action') {
    if (!station.action.disabled) {
      station.action.run()
    }

    return
  }

  editing.value = station.key
}

/**
 * Opens the only station a term left, or steps into the list when it left several.
 * @returns {void}
 */
function submit(): void {
  const only = stations.value.length === 1 ? stations.value[0] : undefined
  if (!only) {
    focusAt(0)
    return
  }

  focusAt(0)

  const primary = rowActionsFor(only)[0]
  if (primary) {
    runAction(only, 0, primary.id)
  }
}

/**
 * Walks the list and backs out of it. Escape leaves one level per press: the open form, then
 * the list, then the term, then the open feature, then admin mode itself.
 * @param {KeyboardEvent} event - Key press bubbling out of the field or a row
 * @returns {void}
 */
function onKeydown(event: KeyboardEvent): void {
  // a row that answered the key already marked it
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
    return
  }

  const target = event.target as HTMLElement | null
  const form = target?.closest<HTMLElement>('.entry-form') ?? null
  const inSearch = Boolean(target?.closest('.launcher'))

  // The arrows walk the panel now, so a dropdown can no longer be arrowed through: Enter opens
  // it instead, and the browser's own list takes the keys from there.
  if (event.key === 'Enter' && target instanceof HTMLSelectElement) {
    event.preventDefault()
    openPicker(target)
    return
  }

  const delta = walkDelta(event, inSearch)

  if (delta !== 0) {
    event.preventDefault()

    if (form && target) {
      stepInForm(form, target, delta)
    } else {
      step(delta)
    }

    return
  }

  // only steal the horizontal arrows once a row is focused, so they stay caret keys for the
  // search field and the form the rest of the time
  if (!form && inList.value && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
    event.preventDefault()
    moveAction(event.key === 'ArrowRight' ? 1 : -1)
    return
  }

  if (event.key !== 'Escape') {
    return
  }

  if (editing.value) {
    void cancelEdit(editing.value)
    return
  }

  const station = active.value

  // An open feature is a level of its own: from inside one, Escape closes it and lands on the
  // feature it belonged to, rather than stepping out to the field and leaving the list open
  // behind it with nowhere obvious to go back to.
  //
  // Where the key came from decides which level this is, rather than the ring's index: a
  // pointer that clicked into the field leaves the index on whatever row it was last on, and
  // reading that would collapse a feature from a caret sitting in the search box.
  if (!inSearch && inList.value && station) {
    if (station.kind === 'entry' || station.kind === 'add') {
      collapseTo(station.feature.id)
      return
    }

    if (station.kind === 'feature' && expanded.value === station.feature.id) {
      collapseTo(station.feature.id)
      return
    }

    leave()
    return
  }

  if (query.value) {
    query.value = ''
    return
  }

  go(expanded.value ? '/admin' : '/')
}

const collapseTo = useCollapseToStation(stations, focusAt, featureKey, () => {
  go(ROUTES.admin)
})

/**
 * Carries out one of a row's actions, whichever way it was asked for: a key on the row, Enter
 * on the one the arrows selected, or a click on its word in the trail.
 * @param {AdminStation} station - Row the action belongs to
 * @param {number} index - Position it holds in the ring
 * @param {RowActionId} id - Action to run
 * @returns {void}
 */
function runAction(station: AdminStation, index: number, id: RowActionId): void {
  if (id === 'open' || id === 'edit') {
    open(station)
    return
  }

  if (station.kind === 'feature') {
    void keepFocus(setFeatureEnabled(station.feature.id, !station.feature.enabled), station.key)
    return
  }

  if (station.kind !== 'entry') {
    return
  }

  if (id === 'up' || id === 'down') {
    void keepFocus(move(station.row.id, id === 'up' ? -1 : 1), station.key)
    return
  }

  if (id === 'toggle') {
    void keepFocus(setEnabled(station.row.id, station.row.enabled === false), station.key)
    return
  }

  if (id === 'sync') {
    // Named so the row can say what it is doing: a sync reaches the connector's own source, and
    // a row that only greyed out would read as a press that did nothing.
    acting.value = station.key
    void keepFocus(sync(station.row.id), station.key).finally(() => {
      acting.value = undefined
    })
    return
  }

  void removeAt(station.row.id, index)
}

/**
 * Adopts the station the pointer put focus on, so clicking a row and arrowing to it leave the
 * ring in the same place.
 * @param {FocusEvent} event - Focus landing inside the list
 * @returns {void}
 */
function onFocusin(event: FocusEvent): void {
  const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-station]')
  if (row?.dataset.station) {
    syncTo(row.dataset.station)
  }
}

onMounted(() => void loadFeatures())
</script>

<template>
  <div class="admin view-shell" @keydown="onKeydown">
    <PortalHeader :title="brand.title" subtitle="admin" />

    <LauncherBar
      ref="bar"
      v-model="query"
      :match-count="stations.length"
      :active-name="active?.label"
      :has-selection="inList"
      placeholder="Search settings and integrations"
      :hints="hints"
      @submit="submit"
    />

    <div v-if="needsAuth" class="admin__notice">
      <p class="admin__notice-text">
        This session has ended. Configuration is only readable while signed in.
      </p>

      <!-- The password form belongs here rather than a link back to the gate: the gate only
           shows on a portal with no config to paint, and this one by definition has some. -->
      <CredentialForm v-if="mode === 'local'" autofocus @done="reload" />

      <button v-else type="button" @click="signIn()">Sign in again</button>
    </div>

    <!-- Not a lapse, so this offers the way out rather than the sign-in form above: the same
         account signing in again lands straight back here. -->
    <div v-else-if="forbidden" class="admin__notice">
      <p class="admin__notice-text">
        This account may not configure the portal. Ask an administrator for access.
      </p>

      <button type="button" @click="go(ROUTES.portal)">Back to the portal</button>
    </div>

    <p v-else-if="error" class="admin__error" role="alert">{{ error }}</p>

    <main v-if="!needsAuth && !forbidden" class="admin__body">
      <ul
        v-if="stations.length"
        ref="list"
        class="admin__features row-tracks"
        role="tree"
        aria-label="Settings and integrations"
        @focusin="onFocusin"
      >
        <template v-for="(station, index) in stations" :key="station.key">
          <AdminFeatureRow
            v-if="station.kind === 'feature'"
            :feature="station.feature"
            :station-key="station.key"
            :expanded="expanded === station.feature.id"
            :active="index === tabStop"
            :focused="index === activeIndex"
            :query="query"
            :busy="busy"
            :refreshing="refreshing && expanded === station.feature.id"
            :actions="rowActionsFor(station)"
            :active-action="index === activeIndex ? activeAction : 0"
            @run="runAction(station, index, $event)"
          />

          <AdminEntryRow
            v-else-if="station.kind === 'entry'"
            :feature="station.feature"
            :row="station.row"
            :station-key="station.key"
            :active="index === tabStop"
            :focused="index === activeIndex"
            :editing="editing === station.key"
            :busy="busy"
            :working="busy && acting === station.key ? busyLabel : undefined"
            :busy-label="busyLabel"
            :actions="rowActionsFor(station)"
            :active-action="index === activeIndex ? activeAction : 0"
            @run="runAction(station, index, $event)"
            @cancel="cancelEdit(station.key)"
            @submit="saveEntry(station.key, station.row.id, $event)"
          />

          <AdminAddRow
            v-else-if="station.kind === 'add'"
            :feature="station.feature"
            :station-key="station.key"
            :active="index === tabStop"
            :editing="editing === station.key"
            :busy="busy"
            :busy-label="busyLabel"
            @open="editing = station.key"
            @cancel="cancelEdit(station.key)"
            @submit="addEntry(station.key, $event)"
          />

          <ActionRow
            v-else
            :action="station.action"
            :station-key="station.key"
            :active="index === tabStop"
            :focused="index === activeIndex"
            :query="query"
            @run="station.action.run()"
          />
        </template>
      </ul>

      <p v-else class="admin__empty">Nothing here matches “{{ query }}”.</p>

      <p v-if="message" class="admin__transfer" :class="{ 'admin__transfer--failed': failed }">
        {{ message }}
      </p>

      <input
        ref="file"
        class="admin__file"
        type="file"
        accept="application/json,.json"
        @change="importSettings"
      />
    </main>
  </div>
</template>

<style scoped>
.admin__notice {
  display: flex;
  flex-direction: column;
  gap: var(--diele-space-3);
  align-items: flex-start;
  width: 100%;
  max-width: 720px;
  padding: var(--diele-space-4);
  border: 1px solid var(--diele-border);
  border-radius: var(--diele-radius-sm);
}

.admin__notice-text {
  margin: 0;
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-md);
  color: var(--diele-fg-muted);
}

.admin__error {
  width: 100%;
  max-width: 720px;
  margin: 0;
  padding: var(--diele-space-3);
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-md);
  color: var(--diele-status-down);
  border: 1px solid var(--diele-status-down);
  border-radius: var(--diele-radius-sm);
}

.admin__body {
  width: 100%;
  max-width: 720px;
}

@media (max-width: 640px) {
  .admin__features {
    display: block;
  }
}

.admin__features {
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
  border-bottom: 3px solid var(--diele-rule);
}

/* Written here rather than on each row, because the rows are of four kinds and a sibling
   selector inside any one of them cannot see the other three. */
.admin__features > li + li {
  border-top: 1px solid var(--diele-rule);
}

.admin__empty {
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-lg);
  color: var(--diele-fg-muted);
}

.admin__transfer {
  margin-top: var(--diele-space-4);
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-sm);
  text-align: center;
  color: var(--diele-fg-muted);
}

.admin__transfer--failed {
  color: var(--diele-status-down);
}

.admin__file {
  display: none;
}
</style>
