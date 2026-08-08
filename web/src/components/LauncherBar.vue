<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue'
import { useGlobalSearchShortcut } from '@/composables/useGlobalSearchShortcut'
import { useRevealOnActive } from '@/composables/useRevealOnActive'

const query = defineModel<string>({ required: true })

interface LauncherBarProps {
  /** Name of the engine Enter submits to while nothing is highlighted; omit to hide the chip */
  engineName?: string
  /** Number of entries left after filtering, announced to screen readers */
  matchCount: number
  /** Name of the highlighted match, announced so the arrow keys are followable by ear */
  activeName?: string
  /** Whether a result holds the selection, so the field knows to drop its own marker */
  hasSelection?: boolean
  /** Replaces the default placeholder, for a bar filtering something other than the portal */
  placeholder?: string
  /** Replaces the default key hints; `key` marks the ones a phone has no keyboard for */
  hints?: ReadonlyArray<{ text: string; key?: boolean }>
  /** id of the element the results render into, so the field can point at what it filters */
  controls?: string
}

const props = defineProps<LauncherBarProps>()
const emit = defineEmits<{ submit: [newTab: boolean]; cycleEngine: [delta: number] }>()

const input = useTemplateRef<HTMLInputElement>('input')

// the field is a station in the highlight ring like any row, so stepping off either end of
// the list has to bring it back on screen as much as landing on a match does
useRevealOnActive(useTemplateRef<HTMLElement>('root'), () => !props.hasSelection, {
  onMount: false,
})

// a hovering pointer stands in for "has a hardware keyboard": autofocusing a touch device
// throws up the on-screen keyboard and hides the page behind it
const CAN_HOVER = '(hover: hover)'

/**
 * Puts the caret in the search field and selects whatever is already there, so the next
 * keystroke starts a fresh query.
 * @returns {void}
 */
function focusInput(): void {
  input.value?.focus()
  input.value?.select()
}

useGlobalSearchShortcut({
  focusAndSelect: focusInput,
  focus: () => input.value?.focus(),
})

/**
 * Releases focus once the field is already empty, which is the way back to the page's own
 * tab order after Tab has been taken over for cycling engines.
 * @returns {void}
 */
function onEscape(): void {
  // Only where Tab was taken over for the engines, which is the one place the caret has to be
  // let go of by hand. A bar without them leaves focus alone, so whoever owns the view can
  // decide what Escape means rather than finding the field already abandoned.
  if (props.engineName && query.value === '') {
    input.value?.blur()
  }
}

/**
 * Cycles the search engine, where there is one to cycle.
 * @param {KeyboardEvent} event - Tab press from the field
 * @param {number} delta - Engines to move by
 * @returns {void}
 */
function onTab(event: KeyboardEvent, delta: number): void {
  if (!props.engineName) {
    return
  }

  event.preventDefault()
  emit('cycleEngine', delta)
}

/**
 * Empties the field and hands the caret back, so clearing does not also lose the focus.
 * @returns {void}
 */
function clearQuery(): void {
  query.value = ''
  input.value?.focus()
}

// the admin list moves focus onto its rows, so it needs a way to hand the caret back here
defineExpose({ focus: focusInput })

onMounted(() => {
  if (window.matchMedia?.(CAN_HOVER).matches) {
    focusInput()
  }
})
</script>

<template>
  <div ref="root" class="launcher">
    <div
      class="launcher__field"
      :class="{ 'launcher__field--marked': !hasSelection, 'row-marker': !hasSelection }"
    >
      <input
        ref="input"
        v-model="query"
        class="launcher__input"
        type="search"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="matchCount > 0"
        :aria-controls="controls"
        :placeholder="placeholder ?? 'Search anything'"
        :aria-label="placeholder ?? 'Search anything'"
        @keydown.enter.prevent="emit('submit', $event.metaKey || $event.ctrlKey)"
        @keydown.esc="onEscape"
        @keydown.tab.exact="onTab($event, 1)"
        @keydown.tab.shift.exact="onTab($event, -1)"
      />

      <button
        v-if="query"
        type="button"
        class="launcher__clear"
        aria-label="Clear the search field"
        @click="clearQuery"
      >
        ×
      </button>

      <button
        v-if="engineName"
        type="button"
        class="launcher__engine"
        :aria-label="`Search engine: ${engineName}. Press to switch`"
        @click="emit('cycleEngine', 1)"
      >
        {{ engineName }}
      </button>
    </div>

    <p class="launcher__hint" aria-hidden="true">
      <template v-if="hints">
        <span
          v-for="entry in hints"
          :key="entry.text"
          class="hint"
          :class="{ 'hint--key': entry.key }"
          >{{ entry.text }}</span
        >
      </template>
      <template v-else>
        <span class="hint">↵ searches {{ engineName }}</span>
        <span class="hint hint--key">tab/shift-tab engine</span>
        <span class="hint hint--key">↑↓ selects</span>
        <span class="hint hint--key">alt shows shortcuts</span>
        <span class="hint">/ for commands</span>
      </template>
    </p>

    <p class="launcher__status" role="status">
      {{ matchCount }} {{ matchCount === 1 ? 'match' : 'matches'
      }}<span v-if="activeName">, {{ activeName }} selected</span>
    </p>
  </div>
</template>

<style scoped>
.launcher {
  width: 100%;
  max-width: 720px;
  scroll-margin-block: var(--diele-reveal-gap);
}

/* Deliberately not a card: the field carries the same gutter, hairline and monospace as the
   result rows, so the page reads as one list that happens to start with an input. */
.launcher__field {
  position: relative;
  display: flex;
  align-items: baseline;
  gap: var(--diele-space-4);
  padding: var(--diele-space-3) var(--diele-space-2) var(--diele-space-3) var(--diele-space-6);
  border-bottom: 3px solid var(--diele-rule);
  transition: border-color var(--diele-transition);
}

.launcher__field:focus-within {
  border-bottom-color: var(--diele-border);
}

/* the same marker the rows use, because the field is where Enter goes when no row is picked */
/* the field itself is not monospace, so the glyph asks for the face the rows draw it in */
.launcher__field--marked::before {
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-base);
}

.launcher__input {
  flex: 1;
  min-width: 0;
  padding: 0;
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-base);
  color: var(--diele-fg);
  background: none;
  border: none;
}

/* The browser's own clear glyph is heavier than anything else on the page, and cannot be
   restyled, so it is hidden and replaced with one in the portal's own weight. */
.launcher__input::-webkit-search-cancel-button {
  appearance: none;
}

.launcher__clear {
  flex: none;
  padding: 0 0.2rem;
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-base);
  line-height: 1;
}

/* a glyph rather than a word, so it takes the accent instead of the underline every other
   action carries */
.launcher__clear:hover,
.launcher__clear:focus-visible {
  color: var(--diele-accent);
  text-decoration: none;
  outline: none;
}

.launcher__input::placeholder {
  color: var(--diele-fg-muted);
}

.launcher__input:focus-visible {
  outline: none;
}

.launcher__engine {
  flex: none;
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-sm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.launcher__engine:hover,
.launcher__engine:focus-visible {
  color: var(--diele-fg);
  outline: none;
}

.launcher__engine:focus-visible {
  text-decoration: underline;
}

.launcher__hint {
  margin-top: var(--diele-space-3);
  padding-left: var(--diele-space-6);
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-xs);
  color: var(--diele-fg-muted);
}

/* Carried by the item rather than written between them, so a hidden hint takes its own
   separator with it. Trailing rather than leading, because the hints a phone hides are the
   ones at the front, and a leading separator would be left standing where they were. */
.hint:not(:last-child)::after {
  content: ' · ';
}

/* a phone has no hardware keyboard for these to describe; tablets are wide enough to keep
   them and often do have one */
@media (max-width: 640px) {
  .hint--key {
    display: none;
  }
}

.launcher__status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
