<script setup lang="ts">
interface CheckBoxProps {
  modelValue: boolean
  disabled?: boolean
  /** Accessible name, for a caller that renders no label of its own around the control */
  label?: string
}

const props = defineProps<CheckBoxProps>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

/**
 * Toggles the box on Enter.
 *
 * A checkbox inside a form answers Enter by submitting it, which leaves this the one control in
 * a form a keyboard cannot actually set: the caret reaches it, and the key that means "do the
 * thing" everywhere else saves the form around it instead. Space still toggles it natively; this
 * only stops Enter meaning something else here than it does on every other row.
 * @param {KeyboardEvent} event - Key press being handled
 * @returns {void}
 */
function onEnter(event: KeyboardEvent): void {
  if (props.disabled) {
    return
  }

  event.preventDefault()
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <!-- The control is the glyph. The platform checkbox is the one part of a form that cannot be
       made to match hairline rules and a mono face, so it is laid over the brackets at full size
       and made transparent: it stays a real checkbox, so space toggles it, a label points at it,
       and assistive technology reads it as one rather than as a span pretending. -->
  <span class="check" :class="{ 'check--on': modelValue }">
    <input
      class="check__input"
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      :aria-label="label"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      @keydown.enter="onEnter"
    />
    <span class="check__box" aria-hidden="true">[{{ modelValue ? '×' : ' ' }}]</span>
  </span>
</template>

<style scoped>
.check {
  position: relative;
  display: inline-flex;
  flex: none;
  cursor: pointer;
}

/* Covers the glyph rather than being hidden outright: an input with `display: none` leaves no
   hit area of its own, and the label would then be the only way to reach it by pointer. */
.check__input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: inherit;
}

.check__box {
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-md);
  line-height: 1;
  color: var(--diele-fg-muted);
  transition: color var(--diele-transition);
}

.check:hover .check__box,
.check--on .check__box {
  color: var(--diele-fg);
}

/* The accent on the brackets rather than the underline every other control focuses with: there
   is no line under a glyph to draw, and a rule beneath two characters reads as a typo. */
.check__input:focus-visible + .check__box {
  color: var(--diele-accent);
  outline: none;
}

.check__input:disabled {
  cursor: not-allowed;
}

.check__input:disabled + .check__box {
  opacity: 0.5;
}
</style>
