<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  shallowRef,
  watch,
  type ComponentPublicInstance,
} from 'vue'
import AdminView from '@/views/AdminView.vue'
import AlertList from '@/features/portal/AlertList.vue'
import CommandList from '@/features/portal/CommandList.vue'
import LauncherBar from '@/components/LauncherBar.vue'
import LoginGate from '@/views/LoginGate.vue'
import EntriesLoading from '@/features/portal/EntriesLoading.vue'
import EntryList from '@/features/portal/EntryList.vue'
import HistoryList from '@/features/portal/HistoryList.vue'
import PageFooter from '@/components/PageFooter.vue'
import PortalHeader from '@/components/PortalHeader.vue'
import ServiceCard from '@/features/portal/ServiceCard.vue'
import SettingsView from '@/views/SettingsView.vue'
import SignedOutBanner from '@/features/portal/SignedOutBanner.vue'
import SiteList from '@/features/portal/SiteList.vue'
import { useAltHeld } from '@/composables/useAltHeld'
import { useConnectorEntries } from '@/composables/useConnectorEntries'
import { useEntrySort } from '@/composables/useEntrySort'
import { useGridColumns } from '@/composables/useGridColumns'
import { ROUTES } from '@/composables/routes'
import { useHashRoute } from '@/composables/useHashRoute'
import { useHealth } from '@/composables/useHealth'
import { useHiddenEntries } from '@/composables/useHiddenEntries'
import { rereadHistory, useHistory } from '@/composables/useHistory'
import { useHistoryDelivery } from '@/composables/useHistoryDelivery'
import { useLocalhostStatus } from '@/composables/useLocalhostStatus'
import { usePortalConfig } from '@/composables/usePortalConfig'
import { usePortalLauncher } from '@/features/portal/usePortalLauncher'
import { useSearchEngine } from '@/features/portal/useSearchEngine'
import { useSession } from '@/composables/useSession'
import { useSessionRecheck } from '@/composables/useSessionRecheck'
import { useSignals } from '@/composables/useSignals'
import { shortcutFor } from '@/features/portal/useLauncher'
import { historyTargets } from '@/features/portal/historyTargets'
import type { PortalTarget } from '@/types/portal'

const {
  rows: entryRows,
  marks: entryMarks,
  isLoading: isLoadingEntries,
  isRefreshing: isRefreshingEntries,
} = useConnectorEntries()
const { sortKey, sortDirection, sorted, sortBy } = useEntrySort(entryRows)
const {
  brand,
  cards,
  sites,
  engines,
  commands: slashCommands,
  settings: portalSettings,
  state: configState,
  hasConfig,
} = usePortalConfig()
const { engine, cycle, urlFor } = useSearchEngine(() => engines.value)
const { isHidden } = useHiddenEntries()
const { user, signOut, setupRequired, reauth, lapsed, resume, loadProviders } = useSession()
const { isAdmin, isSettings, isStyleguide, go, replace } = useHashRoute()

// Only an account that is signed in and told it may not configure is turned away. Someone not
// signed in at all still reaches the panel, because its own lapsed-session path is what offers
// them the sign-in form. The API enforces the same rule independently; this only keeps the
// route from opening a panel whose every action would come back rejected.
const adminDenied = computed(() => user.value !== undefined && !user.value.canAdmin)

// A denied account that lands on #/admin anyway, by a shared link or a hash left in the address
// bar, is sent back rather than left on a route that renders nothing. `replace`, so going back
// does not return to it.
watch(
  [isAdmin, adminDenied],
  ([admin, denied]) => {
    if (admin && denied) {
      replace(ROUTES.portal)
    }
  },
  { immediate: true },
)

// Loaded only while developing. `import.meta.env.DEV` is a literal `false` in a build, so the
// dynamic import below is unreachable there and the view never enters the bundle.
const StyleguideView = import.meta.env.DEV
  ? defineAsyncComponent(() => import('@/views/StyleguideView.vue'))
  : undefined

// Asked for here rather than inside the gate, because whether the gate shows at all now
// depends on the answer. Fetching it there first would need the gate to already be on screen.
void loadProviders()

// Here rather than in a view, because App outlives every one of them: a tab coming back to the
// front re-reads the session whichever screen it is showing.
useSessionRecheck()

// the tiles wrap wherever the viewport lets them, so the arrows ask the layout itself how
// wide a row is rather than assuming a count
const tileGrid = shallowRef<HTMLElement | null>(null)
const tileColumns = useGridColumns(tileGrid)

/**
 * Holds the tile grid's element. A function ref, because the grid renders inside the loop over
 * the blocks, where a named template ref would collect an array instead.
 * @param {Element | ComponentPublicInstance | null} element - The grid, or null once it is gone
 * @returns {void}
 */
function setTileGrid(element: Element | ComponentPublicInstance | null): void {
  tileGrid.value = element instanceof HTMLElement ? element : null
}

// Off is a deliberate setting rather than an absent one, so anything but false is on: a portal
// that has never been told either way keeps the behaviour it shipped with.
const redditEnabled = computed(() => portalSettings.value['reddit.enabled'] !== false)
const alertsEnabled = computed(() => portalSettings.value['alerts.enabled'] !== false)

const visibleRows = computed(() => sorted.value.filter((row) => !isHidden(row.ref)))

// Only a cold start interrupts with a login screen. A lapsed session on a portal that still
// has last visit's config keeps painting it: this is a new tab page, and throwing the user
// at the issuer every time a cookie ages out would be worse than a slightly stale tile. The
// banner above the field says so instead, and signs back in from there when asked.
//
// A portal waiting to be claimed is the exception, and it has to be, because that is exactly
// the case where a cache from a previous run would otherwise paint over the setup screen and
// leave no way to reach it.
//
// `reauth` is the other way in, for a view that has to be signed in to show anything at all:
// the config it is painted over is exactly what keeps the test above from recognising it.
const needsLogin = computed(
  () =>
    setupRequired.value || reauth.value || (configState.value === 'needs-auth' && !hasConfig.value),
)

// The condition the template renders the portal branch under. The launcher's keys are live
// exactly while the list they move is on screen, and the dots are polled for exactly as long as
// there is something drawing them.
const portalShowing = computed(
  () => !isStyleguide.value && !needsLogin.value && !isAdmin.value && !isSettings.value,
)

const { entries: historyEntries } = useHistory(() => portalShowing.value)

// a page the extension delivers while this tab is open is offered without waiting for the next one
useHistoryDelivery(() => portalShowing.value, rereadHistory)

// Visited pages are checked against every row, hidden ones included, so a repo kept out of the
// list does not come back into it through the history.
const visited = computed(() =>
  historyTargets(historyEntries.value, [...sites.value, ...cards.value, ...sorted.value]),
)

// the resting order, which also breaks ties while searching: saved sites, the cards, then the
// connector rows, whose own order already puts a group page ahead of its repos, and the visited
// pages, most frecent first
const targets = computed<ReadonlyArray<PortalTarget>>(() => [
  ...sites.value,
  ...cards.value,
  ...visibleRows.value,
  ...visited.value,
])

const {
  query,
  matches,
  hasSelection,
  activeAction,
  recordLaunch,
  sections,
  highlight,
  commandQuery,
  activeName,
  runCommand,
  submit,
} = usePortalLauncher({
  targets,
  slashCommands,
  redditEnabled,
  offersAdmin: computed(() => !adminDenied.value),
  userName: computed(() => user.value?.name ?? user.value?.email ?? null),
  tileColumns,
  enabled: () => portalShowing.value,
  urlFor,
  openAdmin: () => go(ROUTES.admin),
  openSettings: () => go(ROUTES.settings),
  signOut: () => void signOut(),
})

const { readingFor } = useHealth(() => portalShowing.value)

// Asked for only where the portal has said it wants them, so an instance with the switch off
// never makes the request at all rather than polling for an answer it would not draw.
const {
  signals,
  total: signalTotal,
  silenced,
  silence,
  restore,
} = useSignals(
  () => portalShowing.value && alertsEnabled.value,
  () => user.value?.canAdmin === true,
)
const { isLive } = useLocalhostStatus(() => sites.value)
const altHeld = useAltHeld()
</script>

<template>
  <component :is="StyleguideView" v-if="isStyleguide && StyleguideView" />

  <LoginGate v-else-if="needsLogin" />

  <AdminView v-else-if="isAdmin && !adminDenied" />

  <SettingsView v-else-if="isSettings" />

  <div v-else class="page view-shell">
    <PortalHeader :title="brand.title" :subtitle="brand.subtitle" />

    <SignedOutBanner :lapsed="lapsed" @sign-in="resume" />

    <!-- Above the field and outside the results: something firing is not an answer to the term,
         so it stays put whether or not one is typed. -->
    <AlertList
      :signals="signals"
      :total="signalTotal"
      :silenced="silenced"
      :for-everyone="user?.canAdmin"
      @silence="(id) => void silence(id)"
      @restore="(id) => void restore(id)"
    />

    <LauncherBar
      v-model="query"
      :engine-name="engine?.name ?? ''"
      :match-count="matches.length"
      :active-name="activeName"
      :has-selection="hasSelection"
      controls="launcher-results"
      @submit="submit"
      @cycle-engine="cycle"
    />

    <!-- Named and pointed at by the field rather than marked up as a listbox: the results hold a
         sortable header and a grid of tiles, neither of which a listbox may contain. Which row
         holds the highlight is announced by the field's own live region instead. -->
    <main v-if="matches.length" id="launcher-results" class="stack" aria-label="Search results">
      <!-- Painted in the order the matches rank the blocks, which is also the order the arrows
           walk and the first of which ↵ opens. Each block stays whole; none is pinned in place. -->
      <template v-for="section in sections.order" :key="section">
        <CommandList
          v-if="section === 'commands' && sections.commands.length"
          :commands="sections.commands"
          :active-index="highlight"
          :query="commandQuery"
          @run="runCommand"
        />

        <SiteList
          v-else-if="section === 'suggestions' && sections.suggestions.length"
          :sites="sections.suggestions"
          :active-index="highlight"
          :is-live="isLive"
          :reading-for="readingFor"
          :query="query"
          @launch="recordLaunch($event)"
        />

        <div
          v-else-if="section === 'cards' && sections.cards.length"
          :ref="setTileGrid"
          class="grid"
        >
          <ServiceCard
            v-for="(entry, position) in sections.cards"
            :key="entry.item.ref"
            :service="entry.item"
            :shortcut="altHeld ? shortcutFor(position) : undefined"
            :status="readingFor(entry.item.ref)"
            :active="entry.index === highlight"
            :query="query"
            @launch="recordLaunch(entry.item)"
          />
        </div>

        <template v-else-if="section === 'rows'">
          <EntriesLoading v-if="isLoadingEntries" />

          <EntryList
            v-if="sections.rows.length"
            :entries="sections.rows"
            :marks="entryMarks"
            :sort-key="sortKey"
            :sort-direction="sortDirection"
            :active-index="highlight"
            :active-action="activeAction"
            :refreshing="isRefreshingEntries"
            :query="query"
            @sort="sortBy"
            @launch="recordLaunch($event)"
          />
        </template>

        <HistoryList
          v-else-if="section === 'history' && sections.history.length"
          :pages="sections.history"
          :active-index="highlight"
          :query="query"
          @launch="recordLaunch($event)"
        />
      </template>
    </main>
    <p v-else class="page__empty">
      Nothing here matches “{{ query }}” — ↵ searches {{ engine?.name ?? 'the web' }}.
    </p>

    <PageFooter />
  </div>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--diele-space-12);
  width: 100%;
  margin-top: var(--diele-space-4);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--diele-tile-min), 1fr));
  gap: var(--diele-space-6);
  width: 100%;
  max-width: var(--diele-content-width);
}

.page__empty {
  color: var(--diele-fg-muted);
}
</style>
