<script setup lang="ts">
import { computed } from 'vue'
import AdminIconField from '@/features/admin/AdminIconField.vue'
import CheckBox from '@/components/CheckBox.vue'
import AdminKeywordsField from '@/features/admin/AdminKeywordsField.vue'
import AdminSelectField from '@/features/admin/AdminSelectField.vue'
import type { ApiFieldSpec } from '@diele/common'

interface AdminFieldProps {
  field: ApiFieldSpec
  /** Stored value, whatever shape this field's input mode stores */
  modelValue: unknown
  /** Colour chosen on a sibling field, so an icon can be previewed as the card will draw it */
  accent?: string
  /** Whether a `secret` field already holds one; its value is never sent, so this stands in */
  stored?: boolean
}

const props = defineProps<AdminFieldProps>()

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

// Input modes whose control is an ordinary text box with a different type. Everything not
// listed falls through to `text`; `secret` is here because a write-only field rendering in
// clear was a trap waiting for the first feature to declare one.
const INPUT_TYPES: Partial<Record<ApiFieldSpec['input'], string>> = {
  number: 'number',
  secret: 'password',
}

const text = computed({
  get: () => (props.modelValue == null ? '' : String(props.modelValue)),
  set: (value: unknown) => {
    // vue casts the value of a `type="number"` input, so this arrives as a number rather
    // than the string an input usually gives
    const raw = value == null ? '' : String(value)

    if (props.field.input === 'number') {
      emit('update:modelValue', raw.length > 0 ? Number(raw) : null)
      return
    }

    emit('update:modelValue', raw.length > 0 ? raw : null)
  },
})

const isHex = computed(() => /^#[0-9a-fA-F]{6}$/.test(text.value))

// A stored credential is never sent back, so the box is empty either way and the placeholder is
// the only thing that says whether replacing it would replace something.
const secretPlaceholder = computed(() =>
  props.stored ? 'stored, type to replace' : (props.field.placeholder ?? ''),
)
</script>

<template>
  <label class="field" :class="{ 'field--off': field.unavailable }">
    <span class="field__label">
      {{ field.label }}
      <abbr v-if="field.required" class="field__required" title="required">*</abbr>
      <span v-if="field.unavailable" class="field__soon">soon</span>
    </span>

    <span class="field__body">
      <AdminIconField
        v-if="field.input === 'icon'"
        :model-value="modelValue"
        :accent="accent"
        @update:model-value="emit('update:modelValue', $event)"
      />

      <span v-else class="field__control">
        <AdminSelectField
          v-if="field.input === 'select'"
          :model-value="modelValue"
          :options="field.options ?? []"
          :disabled="Boolean(field.unavailable)"
          @update:model-value="emit('update:modelValue', $event)"
        />

        <AdminKeywordsField
          v-else-if="field.input === 'keywords'"
          :model-value="modelValue"
          :placeholder="field.placeholder"
          :disabled="Boolean(field.unavailable)"
          @update:model-value="emit('update:modelValue', $event)"
        />

        <CheckBox
          v-else-if="field.input === 'toggle'"
          :model-value="modelValue === true"
          :disabled="Boolean(field.unavailable)"
          @update:model-value="emit('update:modelValue', $event)"
        />

        <input
          v-else
          v-model="text"
          class="field__input"
          :type="INPUT_TYPES[field.input] ?? 'text'"
          :placeholder="field.input === 'secret' ? secretPlaceholder : field.placeholder"
          :disabled="Boolean(field.unavailable)"
          spellcheck="false"
          :autocomplete="field.input === 'secret' ? 'new-password' : 'off'"
        />

        <span
          v-if="field.input === 'color' && isHex"
          class="field__swatch"
          :style="{ background: text }"
          aria-hidden="true"
        />
      </span>

      <span v-if="field.unavailable" class="field__hint">{{ field.unavailable }}</span>
      <span v-else-if="field.hint" class="field__hint">{{ field.hint }}</span>
    </span>
  </label>
</template>

<style scoped>
/* A row like every other, one step deeper than the entry it belongs to: the label on the left,
   the control taking the rest of the line. Side by side in columns, every form was a puzzle of
   how wide a column happened to be; down the page each field gets the whole width instead.
   See AdminEntryForm: the tracks are the form's, so every field shares one label column. */
.field {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  column-gap: var(--diele-space-4);
  padding: var(--diele-space-2) var(--diele-space-2) var(--diele-space-2) 0;
}

.field + .field {
  border-top: 1px solid var(--diele-rule);
}

.field--off {
  opacity: 0.6;
}

.field__label {
  display: flex;
  gap: var(--diele-space-2);
  align-items: baseline;
  min-width: 0;
  overflow: hidden;
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--diele-fg-muted);
  white-space: nowrap;
}

.field__required {
  color: var(--diele-accent);
  text-decoration: none;
}

.field__soon {
  font-size: var(--diele-text-2xs);
  color: var(--diele-status-pending);
}

/* the control and whatever explains it, stacked so a hint stays readable rather than being
   squeezed into a track of its own */
.field__body {
  display: flex;
  flex-direction: column;
  gap: var(--diele-space-1);
  min-width: 0;
}

.field__control {
  display: flex;
  gap: var(--diele-space-2);
  align-items: center;
  min-width: 0;
}

/* see base.css: every control is styled there, so a field only places it */
.field__input {
  flex: 1;
  min-width: 0;
}

/* left at its intrinsic size and on the baseline the text controls sit on, so a form of
   mixed fields reads as one column rather than as rows of different heights */
.field__control > .check {
  margin-right: auto;
  padding: 0.3rem 0;
}

.field__swatch {
  flex: none;
  width: 1.1rem;
  height: 1.1rem;
  border: 1px solid var(--diele-border);
  border-radius: 4px;
}

.field__hint {
  font-size: var(--diele-text-xs);
  color: var(--diele-fg-muted);
}

@supports (grid-template-columns: subgrid) {
  .field {
    grid-template-columns: subgrid;
  }
}

/* too narrow for a label beside a control, so the label goes back above it */
@media (max-width: 640px) {
  .field {
    grid-template-columns: minmax(0, 1fr);
    row-gap: var(--diele-space-2);
  }
}
</style>
