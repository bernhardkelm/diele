<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import AdminField from '@/features/admin/AdminField.vue'
import LoadingDots from '@/components/LoadingDots.vue'
import type { ApiFeature, ApiRow } from '@diele/common'

interface AdminEntryFormProps {
  feature: ApiFeature
  /** Row being edited; omitted while adding, which starts the form blank */
  row?: ApiRow
  busy?: boolean
  /** What the pending save is doing, for one that waits on a connector's own source */
  busyLabel?: string
  /** Why the last save was refused, shown here rather than at the top of a list it scrolled off */
  error?: string
}

const props = defineProps<AdminEntryFormProps>()

const emit = defineEmits<{
  submit: [values: Record<string, unknown>]
  cancel: []
}>()

const form = useTemplateRef<HTMLFormElement>('form')

const values = ref<Record<string, unknown>>(seed())

/**
 * Builds the starting values: what the row holds, or nothing at all while adding.
 * @returns {Record<string, unknown>} - Values the fields render from
 */
function seed(): Record<string, unknown> {
  // A blank form starts at whatever each field declares, so a control that cannot show its own
  // default is not drawn contradicting the value that would be stored.
  if (!props.row) {
    return Object.fromEntries(
      props.feature.fields
        .filter((field) => field.default !== undefined)
        .map((field) => [field.key, field.default]),
    )
  }

  const row = props.row

  return Object.fromEntries(
    props.feature.fields.map((field) => [
      field.key,
      // A secret never comes back from the API; the row carries only whether one is set, and
      // seeding the box with that flag would save the word `true` as the credential.
      field.input === 'secret' ? null : (row[field.key] ?? null),
    ]),
  )
}

// A field that depends on another is drawn only while that one holds a value it applies to. What
// a decorator's selector means depends on which decorator was picked, so the variants are
// separate fields rather than one box standing for all of them.
const visible = computed(() =>
  props.feature.fields.filter(
    (field) => !field.showWhen || field.showWhen.value.includes(values.value[field.showWhen.key]),
  ),
)

/**
 * Returns whether a field already holds a stored credential, which is all the API reports.
 * @param {string} key - Field being rendered
 * @returns {boolean} - True when the row says one is set
 */
function isStored(key: string): boolean {
  return props.row?.[key] === true
}

/**
 * Hands the values up and leaves clearing or closing to whoever owns the row.
 * @returns {void}
 */
function submit(): void {
  emit('submit', { ...values.value })
}

// The form opens because a key asked for it, so the caret belongs in it rather than on the row
// that is still holding focus.
onMounted(() => {
  form.value?.querySelector<HTMLElement>('input, select')?.focus()
})
</script>

<template>
  <!-- The form is rendered inside the row, whose own click opens the editor. Without this every
       click on a field or a button reaches that handler as well. -->
  <form
    ref="form"
    class="entry-form"
    @click.stop
    @submit.prevent="submit"
    @keydown.esc.stop.prevent="emit('cancel')"
  >
    <AdminField
      v-for="field in visible"
      :key="field.key"
      :field="field"
      :model-value="values[field.key]"
      :accent="typeof values.color === 'string' ? values.color : undefined"
      :stored="isStored(field.key)"
      @update:model-value="values[field.key] = $event"
    />

    <!-- A refused save names the source and what it answered, which belongs to the form that
         asked rather than above a list the form may have scrolled off the top of. -->
    <p v-if="error" class="entry-form__error" role="alert">{{ error }}</p>

    <div class="entry-form__actions">
      <button type="submit" :disabled="busy">
        {{ row ? 'Save' : 'Add entry' }}
      </button>
      <button type="button" :disabled="busy" @click="emit('cancel')">Cancel</button>

      <span v-if="busy && busyLabel" class="entry-form__working" role="status">
        {{ busyLabel }}<LoadingDots />
      </span>

      <span v-else class="entry-form__hint" aria-hidden="true">
        ↑↓ steps · ↵ saves, or opens a dropdown · esc cancels
      </span>
    </div>
  </form>
</template>

<style scoped>
/* Rules rather than a surface, so the form reads as the row opening up and not as a panel laid
   over the list.
   Its own two tracks rather than the list's: a field's label is a word, and holding it to the
   26ch the rows reserve would spend a quarter of the width on "URL". `auto` takes the widest
   label there is and no more, which the fields share, so they line up with each other and the
   controls get everything that is left. The indent sits here rather than on each field, so the
   tracks are inset once instead of once per row. */
.entry-form {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: var(--diele-space-4);
  margin-top: var(--diele-space-3);
  padding-left: calc(var(--diele-space-6) * 3);
  border-top: 1px solid var(--diele-rule);
}

.entry-form__error {
  grid-column: 1 / -1;
  margin: var(--diele-space-3) 0 0;
  padding: var(--diele-space-2) var(--diele-space-3);
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-sm);
  color: var(--diele-status-down);
  border: 1px solid var(--diele-status-down);
  border-radius: var(--diele-radius-sm);
}

.entry-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--diele-space-3);
  align-items: baseline;
  grid-column: 1 / -1;
  padding: var(--diele-space-3) var(--diele-space-2) var(--diele-space-2) 0;
  border-top: 1px solid var(--diele-rule);
}

@media (--diele-compact) {
  .entry-form {
    padding-left: var(--diele-space-4);
  }
}

.entry-form__hint,
.entry-form__working {
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-xs);
  color: var(--diele-fg-muted);
}

/* the accent, because this is the one thing on the line that is happening rather than told */
.entry-form__working {
  color: var(--diele-accent);
}
</style>
