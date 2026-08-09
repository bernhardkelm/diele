<script setup lang="ts">
import { computed } from 'vue'
import type { ApiFieldOption } from '@diele/common'

interface AdminSelectFieldProps {
  /** Stored value, or null while the field has never been set */
  modelValue: unknown
  options: ReadonlyArray<ApiFieldOption>
  disabled?: boolean
}

const props = defineProps<AdminSelectFieldProps>()
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

// An unset select still paints its first option, so the form reads back what it appears to
// say rather than submitting nothing while showing something.
const value = computed({
  get: () =>
    props.modelValue == null ? (props.options[0]?.value ?? '') : String(props.modelValue),
  set: (next: string) => emit('update:modelValue', next.length > 0 ? next : null),
})
</script>

<template>
  <span class="select">
    <select v-model="value" class="select__input" :disabled="disabled">
      <!-- a disabled option is a choice that exists but is not set up, which is worth saying -->
      <option
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        :disabled="option.disabled"
      >
        {{ option.label }}
      </option>
    </select>
    <span class="select__caret" aria-hidden="true">▾</span>
  </span>
</template>

<style scoped>
.select {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
}

/* see base.css: every control is styled there, so a field only places it */
.select__input {
  flex: 1;
  min-width: 0;
}

/* the arrow the platform would have drawn, in the glyph the rows already expand with */
.select__caret {
  position: absolute;
  top: 50%;
  right: var(--diele-space-3);
  font-size: var(--diele-text-xs);
  line-height: 1;
  color: var(--diele-fg-muted);
  pointer-events: none;
  transform: translateY(-50%);
}
</style>
