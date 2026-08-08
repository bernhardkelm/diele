<script setup lang="ts">
import { computed, defineAsyncComponent, useTemplateRef, watch } from 'vue'
import AdminView from '@/views/AdminView.vue'
import CommandList from '@/features/portal/CommandList.vue'
import LauncherBar from '@/components/LauncherBar.vue'
import LoginGate from '@/views/LoginGate.vue'
import EntriesLoading from '@/features/portal/EntriesLoading.vue'
import EntryList from '@/features/portal/EntryList.vue'
import PortalHeader from '@/components/PortalHeader.vue'
import ServiceCard from '@/features/portal/ServiceCard.vue'
import SettingsView from '@/views/SettingsView.vue'
import SiteList from '@/features/portal/SiteList.vue'
import { useAltHeld } from '@/composables/useAltHeld'
import { useConnectorEntries } from '@/composables/useConnectorEntries'
import { useEntrySort } from '@/composables/useEntrySort'
import { useGridColumns } from '@/composables/useGridColumns'
import { ROUTES } from '@/composables/routes'
import { useHashRoute } from '@/composables/useHashRoute'
import { useHiddenEntries } from '@/composables/useHiddenEntries'
import { useLocalhostStatus } from '@/composables/useLocalhostStatus'
import { usePortalConfig } from '@/composables/usePortalConfig'
import { usePortalLauncher } from '@/features/portal/usePortalLauncher'
import { useSearchEngine } from '@/features/portal/useSearchEngine'
import { useServiceStatus } from '@/composables/useServiceStatus'
import { useSession } from '@/composables/useSession'
import { shortcutFor } from '@/features/portal/useLauncher'
import type { PortalTarget } from '@/types/portal'

const {
  rows: entryRows,
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
const { user, signOut, setupRequired, loadProviders } = useSession()
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

// Read rather than configured: an instance is reached on exactly one host, and it is the one
// thing the page can say about itself without being told.
const host = window.location.host

// the tiles wrap wherever the viewport lets them, so the arrows ask the layout itself how
// wide a row is rather than assuming a count
const tileGrid = useTemplateRef<HTMLElement>('tileGrid')
const tileColumns = useGridColumns(tileGrid)

// Off is a deliberate setting rather than an absent one, so anything but false is on: a portal
// that has never been told either way keeps the behaviour it shipped with.
const redditEnabled = computed(() => portalSettings.value['reddit.enabled'] !== false)

const visibleRows = computed(() => sorted.value.filter((row) => !isHidden(row.ref)))

// Only a cold start interrupts with a login screen. A lapsed session on a portal that still
// has last visit's config keeps painting it: this is a new tab page, and throwing the user
// at the issuer every time a cookie ages out would be worse than a slightly stale tile.
//
// A portal waiting to be claimed is the exception, and it has to be, because that is exactly
// the case where a cache from a previous run would otherwise paint over the setup screen and
// leave no way to reach it.
const needsLogin = computed(
  () => setupRequired.value || (configState.value === 'needs-auth' && !hasConfig.value),
)

// saved sites lead, so a match on one lands at index 0 where it can be auto-highlighted;
// cards keep their positions behind it, then the connector rows, whose own order already puts
// a group page ahead of its repos
const targets = computed<ReadonlyArray<PortalTarget>>(() => [
  ...sites.value,
  ...cards.value,
  ...visibleRows.value,
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
  // the same condition the template renders the launcher under, so its keys are live exactly
  // while the list they move is on screen
  enabled: () => !isStyleguide.value && !needsLogin.value && !isAdmin.value && !isSettings.value,
  urlFor,
  openAdmin: () => go(ROUTES.admin),
  openSettings: () => go(ROUTES.settings),
  signOut: () => void signOut(),
})

const { statusFor } = useServiceStatus(() => cards.value)
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
    <main
      v-if="matches.length"
      id="launcher-results"
      class="stack"
      aria-label="Search results"
    >
      <CommandList
        v-if="sections.commands.length"
        :commands="sections.commands"
        :active-index="highlight"
        :query="commandQuery"
        @run="runCommand"
      />

      <SiteList
        v-if="sections.suggestions.length"
        :sites="sections.suggestions"
        :active-index="highlight"
        :is-live="isLive"
        :query="query"
        @launch="recordLaunch($event)"
      />

      <div v-if="sections.cards.length" ref="tileGrid" class="grid">
        <ServiceCard
          v-for="(entry, position) in sections.cards"
          :key="entry.item.ref"
          :service="entry.item"
          :shortcut="altHeld ? shortcutFor(position) : undefined"
          :status="statusFor(entry.item)"
          :active="entry.index === highlight"
          :query="query"
          @launch="recordLaunch(entry.item)"
        />
      </div>

      <EntriesLoading v-if="isLoadingEntries" />

      <EntryList
        v-if="sections.rows.length"
        :entries="sections.rows"
        :sort-key="sortKey"
        :sort-direction="sortDirection"
        :active-index="highlight"
        :active-action="activeAction"
        :refreshing="isRefreshingEntries"
        :query="query"
        @sort="sortBy"
        @launch="recordLaunch($event)"
      />
    </main>
    <p v-else class="page__empty">
      Nothing here matches “{{ query }}” — ↵ searches {{ engine?.name ?? 'the web' }}.
    </p>

    <footer class="page__footer">
      <span>{{ host }}</span>
    </footer>
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
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--diele-space-6);
  width: 100%;
  max-width: 720px;
}

.page__empty {
  color: var(--diele-fg-muted);
}

.page__footer {
  margin-top: auto;
  font-size: var(--diele-text-md);
  letter-spacing: 0.04em;
  color: var(--diele-fg-muted);
}
</style>
