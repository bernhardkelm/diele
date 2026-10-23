<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import LoadingDots from '@/components/LoadingDots.vue'
import ScrollingText from '@/components/ScrollingText.vue'
import { useStationRow } from '@/composables/useStationRow'
import type { SettingsField } from '@/features/settings/settingsSections'

interface SettingsFieldRowProps {
  field: SettingsField
  /** Station key, mirrored onto the element so the ring can find and focus it */
  stationKey: string
  /** Whether this row is the list's single tab stop */
  active?: boolean
  /** Whether this row actually holds focus, which is what reads its line out */
  focused?: boolean
  editing?: boolean
}

const props = defineProps<SettingsFieldRowProps>()

const emit = defineEmits<{ open: []; close: [] }>()

const { attrs: stationAttrs, ownsEvent } = useStationRow({
  stationKey: () => props.stationKey,
  active: () => props.active,
  level: 2,
})

const root = useTemplateRef<HTMLElement>('root')
const input = useTemplateRef<HTMLInputElement>('input')

const value = ref('')
const busy = ref(false)
const error = ref<string | undefined>()

// The form opens because a key asked for it, so the caret belongs in it rather than on the row
// that is still holding focus.
watch(
  () => props.editing,
  async (open) => {
    if (!open) {
      value.value = ''
      error.value = undefined
      return
    }

    await nextTick()
    input.value?.focus()
  },
)

/**
 * Opens the form. The row is a station like any other, so adding is reached by walking to it
 * rather than by finding a box below the list.
 * @param {KeyboardEvent} event - Key press being handled
 * @returns {void}
 */
function onKeydown(event: KeyboardEvent): void {
  if (!ownsEvent(event) || event.key !== 'Enter') {
    return
  }

  event.preventDefault()
  emit('open')
}

/**
 * Closes the form and hands the caret back to the row, so the ring carries on from where it was.
 * @returns {void}
 */
function close(): void {
  root.value?.focus()
  emit('close')
}

/**
 * Keeps the keys that move through the list inside the form while it is open: the field and its
 * two buttons are walked the way any form is, and Escape closes it rather than the section.
 * @param {KeyboardEvent} event - Key press bubbling out of the form
 * @returns {void}
 */
function onFormKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }

  if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Tab') {
    event.stopPropagation()
  }
}

/**
 * Hands what was typed to the section, closing the form once it is taken and keeping it open
 * with the reason where it is refused.
 * @returns {Promise<void>}
 */
async function submit(): Promise<void> {
  if (busy.value) {
    return
  }

  busy.value = true
  error.value = undefined

  try {
    const refused = await props.field.submit(value.value)

    if (refused) {
      error.value = refused
      input.value?.focus()
      return
    }

    close()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <li
    ref="root"
    class="add row-shell row-marker-within row-grammar"
    v-bind="stationAttrs"
    :aria-label="field.label"
    @keydown="onKeydown"
    @click="!editing && emit('open')"
  >
    <span class="add__name truncate">{{ field.label }}</span>

    <ScrollingText class="add__detail" :text="field.detail" :focused="focused" />

    <span class="add__trail" aria-hidden="true">↵</span>

    <!-- inside the row, whose own click opens the form, so a click in here must stop at it -->
    <form
      v-if="editing"
      class="add__form"
      @click.stop
      @submit.prevent="submit"
      @keydown="onFormKeydown"
    >
      <label class="add__field">
        <span class="add__label">{{ field.inputLabel }}</span>
        <input
          ref="input"
          v-model="value"
          class="add__input"
          type="text"
          :placeholder="field.placeholder"
          :disabled="busy"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
        />
      </label>

      <p v-if="error" class="add__error" role="alert">{{ error }}</p>

      <div class="add__actions">
        <button type="submit" :disabled="busy">{{ field.submitLabel }}</button>
        <button type="button" :disabled="busy" @click="close">Cancel</button>

        <span v-if="busy" class="add__working" role="status">saving<LoadingDots /></span>
        <span v-else class="add__hint" aria-hidden="true">↵ saves · tab steps · esc cancels</span>
      </div>
    </form>
  </li>
</template>

<style scoped>
/* see AdminAddRow: the same gutter and the same `+` marker, which is what says this row adds
   rather than opens */
.add {
  --row-gutter: var(--add-gutter);
  --add-gutter: calc(var(--diele-space-6) * 2);
  --row-marker-left: var(--diele-space-8);
  --diele-marker: '+';

  cursor: pointer;
}

.add:hover,
.add:focus,
.add:focus-within {
  color: var(--diele-fg);
  outline: none;
}

.add__name {
  color: var(--diele-fg);
}

/* see ScrollingText: it owns the clipping, because it has to lift it while looping */
.add__detail {
  min-width: 0;
}

.add__trail {
  justify-self: end;
  font-size: var(--diele-text-sm);
  opacity: 0;
  transition: opacity var(--diele-transition);
}

.add:hover .add__trail,
.add:focus .add__trail {
  opacity: 1;
}

/* see AdminEntryForm: rules rather than a surface, so the form reads as the row opening up */
.add__form {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: minmax(0, 1fr);
  margin-top: var(--diele-space-3);
  padding-left: calc(var(--diele-space-6) * 3);
  border-top: 1px solid var(--diele-rule);
  cursor: auto;
}

/* see AdminField: the label beside the control, set the way every form field's is */
.add__field {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  column-gap: var(--diele-space-4);
  padding: var(--diele-space-2) var(--diele-space-2) var(--diele-space-2) 0;
}

.add__label {
  font-size: var(--diele-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--diele-fg-muted);
  white-space: nowrap;
}

/* see base.css: every control is styled there, so the field only places it */
.add__input {
  min-width: 0;
}

.add__error {
  margin: var(--diele-space-3) 0 0;
  padding: var(--diele-space-2) var(--diele-space-3);
  font-size: var(--diele-text-sm);
  color: var(--diele-status-down);
  border: 1px solid var(--diele-status-down);
  border-radius: var(--diele-radius-sm);
}

.add__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--diele-space-3);
  align-items: baseline;
  padding: var(--diele-space-3) var(--diele-space-2) var(--diele-space-2) 0;
  border-top: 1px solid var(--diele-rule);
}

.add__hint,
.add__working {
  font-size: var(--diele-text-xs);
  color: var(--diele-fg-muted);
}

/* the accent, because this is the one thing on the line that is happening rather than told */
.add__working {
  color: var(--diele-accent);
}

@media (--diele-compact) {
  .add {
    --add-gutter: var(--diele-space-4);
    --row-marker-left: var(--diele-space-2);

    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: var(--diele-space-2);
  }

  .add__detail {
    grid-row: 2;
    grid-column: 1 / -1;
  }

  .add__form {
    padding-left: var(--diele-space-4);
  }

  .add__field {
    grid-template-columns: minmax(0, 1fr);
    row-gap: var(--diele-space-2);
  }
}

@media (prefers-reduced-motion: reduce) {
  .add,
  .add__trail {
    transition: none;
  }
}
</style>
