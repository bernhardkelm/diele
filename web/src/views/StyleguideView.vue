<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AdminEntryRow from '@/features/admin/AdminEntryRow.vue'
import AdminSelectField from '@/features/admin/AdminSelectField.vue'
import CheckBox from '@/components/CheckBox.vue'
import CommandList from '@/features/portal/CommandList.vue'
import LoadingDots from '@/components/LoadingDots.vue'
import PortalHeader from '@/components/PortalHeader.vue'
import ServiceCard from '@/features/portal/ServiceCard.vue'
import SiteList from '@/features/portal/SiteList.vue'
import StatusDot from '@/components/StatusDot.vue'
import StyleguideTokenRow from '@/features/styleguide/StyleguideTokenRow.vue'
import { ROUTES } from '@/composables/routes'
import { useHashRoute } from '@/composables/useHashRoute'
import { usePortalConfig } from '@/composables/usePortalConfig'
import { useTheme } from '@/composables/useTheme'
import {
  CARD,
  COMMANDS,
  ENTRY_ACTIONS,
  ENTRY_ROWS,
  FEATURE,
  SELECT_OPTIONS,
  SITES,
} from '@/features/styleguide/styleguideSpecimens'
import { TOKEN_GROUPS, resolveColor, resolveToken } from '@/features/styleguide/styleguideTokens'

const checked = ref(true)

const { brand } = usePortalConfig()
const { go } = useHashRoute()
const { preference, set: setTheme } = useTheme()

// Bumped after the theme changes, because the resolved values come from getComputedStyle and
// nothing about that is reactive on its own.
const revision = ref(0)

const groups = computed(() =>
  TOKEN_GROUPS.map((group) => ({
    ...group,
    // read through the counter so switching theme recomputes the whole table
    entries: group.tokens.map((token) => ({
      token,
      value: revision.value >= 0 ? resolveToken(token.name) : '',
      computedValue: token.kind === 'color' ? resolveColor(token.name) : '',
    })),
  })),
)

onMounted(() => {
  revision.value += 1
})

/**
 * Switches theme and re-reads every token, so the table shows the side being looked at.
 * @param {'light' | 'dark' | 'system'} next - Theme to apply
 * @returns {void}
 */
function choose(next: 'light' | 'dark' | 'system'): void {
  setTheme(next)
  // after the class lands on the root, so the new values are the ones read
  requestAnimationFrame(() => {
    revision.value += 1
  })
}
</script>

<template>
  <div class="guide">
    <PortalHeader :title="brand.title" subtitle="styleguide" />

    <p class="guide__lede">
      Every token as it resolves right now. Development only, so this route does not exist in a
      production build.
    </p>

    <div class="guide__themes" role="group" aria-label="Theme">
      <button
        v-for="option in ['light', 'dark', 'system'] as const"
        :key="option"
        class="guide__theme"
        :class="{ 'guide__theme--on': preference === option }"
        type="button"
        @click="choose(option)"
      >
        {{ option }}
      </button>
    </div>

    <section v-for="group in groups" :key="group.title" class="guide__section">
      <h2 class="guide__title">{{ group.title }}</h2>
      <p v-if="group.note" class="guide__note">{{ group.note }}</p>

      <ul class="guide__tokens">
        <StyleguideTokenRow
          v-for="entry in group.entries"
          :key="entry.token.name"
          :token="entry.token"
          :value="entry.value"
          :computed-value="entry.computedValue"
        />
      </ul>
    </section>

    <section class="guide__section">
      <h2 class="guide__title">Elements</h2>
      <p class="guide__note">The recurring pieces, so a change to a token can be judged here.</p>

      <div class="guide__specimens">
        <div class="specimen specimen--wide">
          <span class="specimen__label">Row grammar</span>
          <p class="specimen__note">
            Label · detail · trail on shared tracks, separated by a rule rather than boxed. Every
            list in the portal is built from this, at two depths.
          </p>
          <!-- The real lists, not a copy of them: whatever the row components do, this shows.
               The second row of each is the highlighted one, so the marker is on screen. -->
          <CommandList :commands="COMMANDS" :active-index="1" />
          <SiteList :sites="SITES" :active-index="1" />

          <p class="specimen__note">
            One level deeper, an admin entry keeps the same tracks and adds its trail actions. The
            second is switched off, which dims the row rather than hiding it.
          </p>
          <!-- a treeitem has to be owned by a tree, and these are the real rows -->
          <ul class="specimen__rows row-tracks" role="tree" aria-label="Row grammar specimen">
            <AdminEntryRow
              v-for="(row, index) in ENTRY_ROWS"
              :key="row.id"
              :feature="FEATURE"
              :row="row"
              :station-key="`styleguide:${row.id}`"
              :actions="ENTRY_ACTIONS"
              :active="index === 0"
            />
          </ul>
        </div>

        <div class="specimen">
          <span class="specimen__label">Actions</span>
          <p class="specimen__note">
            Nothing carries a box. Every interaction is text that underlines, whether it sits in a
            row's trail, in a form or on its own.
          </p>
          <div class="specimen__set specimen__set--baseline">
            <button type="button">Sign in</button>
            <button class="specimen__button--on" type="button">Selected</button>
            <button type="button" disabled>Disabled</button>
            <button class="specimen__button--danger" type="button">del</button>
          </div>
        </div>

        <div class="specimen">
          <span class="specimen__label">Fields</span>
          <p class="specimen__note">
            A line rather than a box, on the same hairline the rows are separated by. The underline
            turns accent to say where the caret is.
          </p>
          <div class="specimen__set">
            <input type="text" placeholder="text input" />
            <input type="password" value="secret value" readonly />
            <input type="number" value="5173" readonly />
            <!-- the real select, caret and all, rather than a copy of its markup -->
            <AdminSelectField model-value="https" :options="SELECT_OPTIONS" />
          </div>
        </div>

        <div class="specimen">
          <span class="specimen__label">Checkbox</span>
          <p class="specimen__note">
            Brackets rather than the platform's box, which is the one control that cannot be made to
            match a hairline and a mono face. A real checkbox sits over it at full size and
            transparent, so space toggles it and it is read as one. Focus colours the brackets
            instead of underlining them: there is no line under a glyph worth drawing.
          </p>
          <div class="specimen__set specimen__set--baseline">
            <CheckBox v-model="checked" label="A checkbox, on" />
            <CheckBox :model-value="false" label="A checkbox, off" @update:model-value="() => {}" />
            <CheckBox :model-value="true" disabled label="A checkbox, on and disabled" />
          </div>
        </div>

        <div class="specimen">
          <span class="specimen__label">Working</span>
          <p class="specimen__note">
            What a wait looks like. The dots keep their box while transparent, so nothing reflows as
            they cycle, and the word says which wait it is.
          </p>
          <div class="specimen__set specimen__set--baseline">
            <span class="specimen__working">checking<LoadingDots /></span>
            <span class="specimen__working">syncing<LoadingDots /></span>
          </div>
        </div>

        <div class="specimen">
          <span class="specimen__label">Status</span>
          <!-- the real dot, so a change to it shows here rather than being mimicked -->
          <div class="specimen__set specimen__set--baseline">
            <span
              v-for="state in ['up', 'down', 'pending', 'maintenance'] as const"
              :key="state"
              class="specimen__state"
            >
              <StatusDot :status="{ state }" :name="state" />
              {{ state }}
            </span>
          </div>

          <div class="specimen__set specimen__set--baseline">
            <span class="specimen__badge specimen__badge--soon">soon</span>
            <span class="specimen__badge specimen__badge--off">off</span>
            <span class="specimen__badge">BUILTIN</span>
          </div>
        </div>

        <div class="specimen">
          <span class="specimen__label">Messages</span>
          <p class="specimen__error" role="none">
            something the server refused, in the down colour
          </p>
          <p class="specimen__hint">a hint, in the muted colour</p>
          <p class="specimen__hit">
            a search result with its <mark class="specimen__mark">match</mark> backed
          </p>
        </div>

        <div class="specimen">
          <span class="specimen__label">Card</span>
          <!-- the real tile, monitored and highlighted, so both states are shown as they ship -->
          <div class="specimen__set">
            <ServiceCard :service="CARD" shortcut="1" :status="{ state: 'up' }" />
            <ServiceCard :service="CARD" :active="true" />
          </div>
        </div>
      </div>
    </section>

    <button class="guide__back" type="button" @click="go(ROUTES.portal)">← back to portal</button>
  </div>
</template>

<style scoped>
.guide {
  display: flex;
  flex-direction: column;
  gap: var(--diele-space-6);
  align-items: center;
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--diele-space-12) var(--diele-space-6);
}

.guide__lede,
.guide__note {
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-md);
  line-height: 1.6;
  color: var(--diele-fg-muted);
}

.guide__lede {
  max-width: 46rem;
  text-align: center;
}

.guide__themes {
  display: flex;
  gap: var(--diele-space-4);
}

/* see base.css: bare text like every other action, spaced further apart because they read as
   one set of three rather than as separate controls */
.guide__theme {
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.guide__theme--on {
  color: var(--diele-accent);
  text-decoration: underline;
}

.guide__section {
  width: 100%;
}

.guide__title {
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-md);
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--diele-fg);
}

.guide__note {
  margin-top: var(--diele-space-2);
}

.guide__tokens {
  margin: var(--diele-space-3) 0 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--diele-border);
  border-bottom: 1px solid var(--diele-border);
}

.guide__specimens {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
  gap: var(--diele-space-6);
  margin-top: var(--diele-space-4);
}

/* the rows are the one specimen that needs the width they actually get in the portal, or the
   detail column reads as broken when it is only the panel being narrow */
.specimen--wide {
  grid-column: 1 / -1;
}

.specimen {
  display: flex;
  flex-direction: column;
  gap: var(--diele-space-3);
  padding: var(--diele-space-4);
  border: 1px solid var(--diele-border);
  border-radius: var(--diele-radius-sm);
}

.specimen__label {
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-2xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--diele-fg-muted);
}

.specimen__set {
  display: flex;
  flex-wrap: wrap;
  gap: var(--diele-space-3);
  align-items: center;
}

.specimen__working {
  display: inline-flex;
  align-items: baseline;
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-sm);
  color: var(--diele-fg-muted);
}

.specimen__set--baseline {
  align-items: baseline;
}

.specimen__rows {
  margin: 0;
  padding: 0;
  list-style: none;
}

.specimen__note {
  margin: 0;
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-xs);
  line-height: 1.5;
  color: var(--diele-fg-muted);
}

/* see base.css: every button is bare text, so the specimen only shows the states it takes */
.specimen__button--on {
  color: var(--diele-accent);
  text-decoration: underline;
}

.specimen__button--danger {
  color: var(--diele-status-down);
}

.specimen__state {
  display: flex;
  gap: var(--diele-space-2);
  align-items: center;
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-xs);
  color: var(--diele-fg-muted);
}

.specimen__badge {
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-2xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--diele-fg-muted);
}

.specimen__badge--soon,
.specimen__badge--off {
  text-transform: none;
  letter-spacing: 0;
  color: var(--diele-status-pending);
}

.specimen__error {
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-md);
  color: var(--diele-status-down);
}

.specimen__hint,
.specimen__hit {
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-md);
  color: var(--diele-fg-muted);
}

.specimen__mark {
  color: inherit;
  background: var(--diele-hit);
}

.guide__back {
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-md);
}
</style>
