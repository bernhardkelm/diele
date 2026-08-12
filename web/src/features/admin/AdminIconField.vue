<script setup lang="ts">
import { computed, onMounted, useTemplateRef, watch } from 'vue'
import AdminSelectField from '@/features/admin/AdminSelectField.vue'
import { useArmedAction } from '@/composables/useArmedAction'
import { useIcons } from '@/composables/useIcons'

interface AdminIconFieldProps {
  /** Stored icon id, or anything else when the field has never been set */
  modelValue: unknown
  /** Colour the card will draw this icon in, so the choice is made against the real thing */
  accent?: string
}

const props = defineProps<AdminIconFieldProps>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()

const { icons, error, busy, load, upload, remove, svgFor } = useIcons()
const file = useTemplateRef<HTMLInputElement>('file')

const selectedId = computed(() => (typeof props.modelValue === 'number' ? props.modelValue : null))
const preview = computed(() => svgFor(selectedId.value))

// A delete takes the icon off every card that uses it, not only off the one being edited, so it
// asks for a second press. Armed against the icon that was chosen when it was armed: switching
// the picker in between would otherwise delete whatever the second press happened to land on.
const { armed, press, disarm, onFocusout } = useArmedAction()

watch(selectedId, () => {
  disarm()
})

// The blank option leads, so clearing an icon is a choice in the list rather than a second
// control next to it.
const options = computed(() => [
  { value: '', label: 'No icon' },
  ...icons.value.map((entry) => ({ value: String(entry.id), label: entry.name })),
])

// Checked rather than trusted: the value is typed into a field and ends up in a style
// attribute, so anything that is not plainly a colour is not one.
const tint = computed(() =>
  props.accent && /^#[0-9a-fA-F]{6}$/.test(props.accent) ? props.accent : undefined,
)

onMounted(() => void load())

/**
 * Uploads the chosen file and selects the icon it produced.
 * @param {Event} event - Change event from the file input
 * @returns {Promise<void>}
 */
async function onFile(event: Event): Promise<void> {
  const chosen = (event.target as HTMLInputElement).files?.[0]
  if (!chosen) {
    return
  }

  // an upload that is refused leaves the selection alone, so nothing else here would disarm it
  disarm()

  const icon = await upload(chosen)
  if (icon) {
    emit('update:modelValue', icon.id)
  }

  // cleared so choosing the same file again still fires a change
  if (file.value) {
    file.value.value = ''
  }
}

/**
 * Arms the delete on the first press and carries it out on the second, clearing the field so it
 * is not left pointing at an icon that is gone.
 * @returns {Promise<void>}
 */
async function onDelete(): Promise<void> {
  const id = selectedId.value
  if (id === null) {
    return
  }

  await press(async () => {
    if (await remove(id)) {
      emit('update:modelValue', null)
    }
  })
}
</script>

<template>
  <div class="icon" @focusout="onFocusout">
    <div class="icon__row">
      <!-- Kept in the flow whether or not it holds anything, so choosing an icon does not
           shift the control it was chosen from. The list already says when there is none. -->
      <span
        class="icon__preview"
        aria-hidden="true"
        :style="tint ? { color: tint } : undefined"
        v-html="preview"
      />

      <AdminSelectField
        :model-value="selectedId ?? ''"
        :options="options"
        @update:model-value="emit('update:modelValue', $event ? Number($event) : null)"
      />

      <button type="button" :disabled="busy" @click="file?.click()">
        {{ busy ? 'Uploading…' : 'Upload svg' }}
      </button>

      <button
        type="button"
        class="icon__delete"
        :class="{ 'icon__delete--armed': armed }"
        :disabled="busy || selectedId === null"
        @click="onDelete"
      >
        {{ armed ? 'Press again to delete' : 'Delete icon' }}
      </button>

      <!-- see AdminEntryRow .entry__confirm: an armed delete is announced rather than only
           drawn. The words are on the button too, but a label that changes under the focus
           already on it is not reliably read out. -->
      <span v-if="armed" class="icon__confirm" role="status">Press again to delete</span>

      <input
        ref="file"
        class="icon__file"
        type="file"
        accept=".svg,image/svg+xml"
        @change="onFile"
      />
    </div>

    <p v-if="error" class="icon__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.icon__row {
  display: flex;
  gap: var(--diele-space-2);
  align-items: center;
  min-width: 0;
}

/* No box of its own: the icon is the preview, and a frame around it would be the only one left
   on a page that has none. Its width is held whether or not one is chosen. */
.icon__preview {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 1.2rem;
  height: 1.2rem;
  color: var(--diele-fg);
}

/* see ServiceCard: a shape that carries no fill of its own defaults to black, so the colour
   has to be handed to it rather than only set on the box around it */
.icon__preview :deep(svg) {
  width: 100%;
  height: 100%;
  fill: currentColor;
}

.icon__file {
  display: none;
}

/* see AdminEntryRow .entry__confirm: an armed delete carries the same colour wherever it is
   asked for a second time. Stated for hover too, which the base rule would otherwise take back
   to the ordinary foreground. */
.icon__delete--armed,
.icon__delete--armed:hover:not(:disabled) {
  color: var(--diele-status-down);
}

/* see StatusDot .status__label: carried for assistive technology only, the button beside it
   already says the same thing on screen */
.icon__confirm {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.icon__error {
  margin: var(--diele-space-1) 0 0;
  font-size: var(--diele-text-xs);
  color: var(--diele-status-down);
}
</style>
