<script setup lang="ts">
import CommandRow from '@/features/portal/CommandRow.vue'
import type { Indexed } from '@/features/portal/launchTargets'
import type { CommandTarget } from '@/types/portal'

interface CommandListProps {
  commands: ReadonlyArray<Indexed<CommandTarget>>
  /** Position of the launcher highlight; omitted while nothing is selected */
  activeIndex?: number
  /** Term filtering the menu, its prefix already stripped, marked up in the rows */
  query?: string
}

defineProps<CommandListProps>()
const emit = defineEmits<{ run: [command: CommandTarget] }>()
</script>

<template>
  <ul class="commands row-tracks">
    <CommandRow
      v-for="entry in commands"
      :key="entry.item.ref"
      :command="entry.item"
      :active="entry.index === activeIndex"
      :query="query"
      @run="emit('run', entry.item)"
    />
  </ul>
</template>

<style scoped>
/* the rows stack at this width and lay themselves out, so the list holds no tracks */
@media (max-width: 640px) {
  .commands {
    display: block;
  }
}

.commands {
  width: 100%;
  max-width: 720px;
  padding: 0;
  list-style: none;
  border-bottom: 3px solid var(--diele-rule);
}
</style>
