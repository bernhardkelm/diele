<script setup lang="ts">
import { useTemplateRef } from 'vue'
import HighlightedText from '@/components/HighlightedText.vue'
import { useRevealOnActive } from '@/composables/useRevealOnActive'
import type { CommandTarget } from '@/types/portal'

interface CommandRowProps {
  command: CommandTarget
  /** Whether the launcher highlight currently sits on this row */
  active?: boolean
  /** Term filtering the menu, its prefix already stripped, marked up in the entry's name */
  query?: string
}

const props = defineProps<CommandRowProps>()
const emit = defineEmits<{ run: [] }>()

useRevealOnActive(useTemplateRef<HTMLElement>('root'), () => props.active)
</script>

<template>
  <li
    ref="root"
    class="command row-grammar-pass"
    :class="{ 'command--active': active, 'row-marker': active }"
  >
    <button type="button" class="command__button row-grammar" @click="emit('run')">
      <span class="command__name truncate"
        ><HighlightedText :text="command.name" :query="query"
      /></span>
      <span class="command__hint truncate">{{ command.hint }}</span>
      <span class="command__enter" aria-hidden="true">↵</span>
    </button>
  </li>
</template>

<style scoped>
.command {
  --row-marker-top: var(--diele-space-3);

  position: relative;
  scroll-margin-block: var(--diele-reveal-gap);
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-lg);
}

.command + .command {
  border-top: 1px solid var(--diele-rule);
}

/* see base.css .row-grammar; the button is what paints the tracks the row hands down */
.command__button {
  width: 100%;
  padding: var(--diele-space-3) var(--diele-space-2) var(--diele-space-3) var(--diele-space-6);
  text-align: left;
}

.command__button:hover,
.command__button:focus-visible,
.command--active .command__button {
  color: var(--diele-fg);
  outline: none;
}

.command__name {
  color: var(--diele-fg);
  font-weight: 600;
}

.command__enter {
  opacity: 0;
  transition: opacity var(--diele-transition);
}

.command--active .command__enter {
  opacity: 1;
}

/* the row stacks at this width, so it stops passing the list's tracks down */
@media (--diele-compact) {
  .command {
    display: block;
  }
}

/* see ProjectRow: the marker indents its own row rather than every row reserving a gutter.
   A phone has no width to set a hint beside its name, and the hint is what says what an
   entry does, so it takes a line of its own rather than being cut. */
@media (--diele-compact) {
  .command__button {
    grid-template-columns: minmax(0, 1fr) auto;
    /* tighter than the column gap, so the hint reads as belonging to the name above it */
    row-gap: var(--diele-space-2);
    padding-left: 0;
  }

  .command__name {
    grid-column: 1;
  }

  .command__enter {
    grid-row: 1;
    grid-column: 2;
  }

  .command__hint {
    grid-row: 2;
    grid-column: 1 / -1;
  }

  .command--active .command__button {
    padding-left: var(--diele-space-3);
  }

  .command--active {
    --row-marker-left: 0;
  }
}
</style>
