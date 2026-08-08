<script setup lang="ts">
import { ref, watch } from 'vue'

interface AdminKeywordsFieldProps {
  /** Stored keywords, expected to be an array of strings */
  modelValue: unknown
  placeholder?: string
  disabled?: boolean
}

const props = defineProps<AdminKeywordsFieldProps>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

/**
 * Splits a typed line into keywords.
 * @param {string} value - Raw text as typed
 * @returns {string[]} - Keywords, blanks dropped
 */
function parseKeywords(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/**
 * Renders a stored keyword list back as a line.
 * @param {unknown} value - Stored value, expected to be an array
 * @returns {string} - Comma separated line
 */
function joinKeywords(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : ''
}

// Keywords are stored as an array but typed as one line, so the text has to be held here as
// well. Round-tripping every keystroke through the array would parse `graf,` back to `graf`
// and delete the separator the moment it was typed, which makes the field impossible to use.
const typed = ref(joinKeywords(props.modelValue))

watch(
  () => props.modelValue,
  (value) => {
    const current = parseKeywords(typed.value)
    const incoming = Array.isArray(value) ? (value as string[]) : []

    // resync only when the value changed for some reason other than this field's own typing,
    // so a half-typed `graf,` is not parsed back to `graf` and stripped of its separator
    if (
      current.length !== incoming.length ||
      current.some((entry, index) => entry !== incoming[index])
    ) {
      typed.value = joinKeywords(value)
    }
  },
)

watch(typed, (value) => emit('update:modelValue', parseKeywords(value)))
</script>

<template>
  <input
    v-model="typed"
    class="keywords"
    type="text"
    :placeholder="placeholder"
    :disabled="disabled"
    spellcheck="false"
    autocomplete="off"
  />
</template>

<style scoped>
/* see base.css: every control is styled there, so a field only places it */
.keywords {
  flex: 1;
  min-width: 0;
}
</style>
