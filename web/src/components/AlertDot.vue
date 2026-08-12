<script setup lang="ts">
import type { SignalSeverity } from '@diele/common'

interface AlertDotProps {
  severity: SignalSeverity
}

defineProps<AlertDotProps>()
</script>

<template>
  <!-- Decorative: what is firing and how badly is written next to it, so a dot that also
       announced itself would say everything twice. -->
  <span class="alert-dot" :class="`alert-dot--${severity}`" aria-hidden="true" />
</template>

<style scoped>
/* The status dot's shape and tokens, so a line saying something is wrong reads as the same
   language as the dot on the card it is wrong about. Its own component rather than a StatusDot
   with a borrowed state, because `critical` is not `down`: nothing here is claiming a service is
   unreachable, and the screen reader wording that goes with one would be false on the other. */
.alert-dot {
  display: inline-block;
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--diele-fg-muted);
}

/* halo weight differs per severity, so the dot does not rely on hue alone */
.alert-dot--critical {
  background: var(--diele-status-down);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--diele-status-down) 30%, transparent);
}

.alert-dot--warning {
  background: var(--diele-status-pending);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--diele-status-pending) 25%, transparent);
}

/* No halo at all: an info is on the page to be read, not to be noticed from across the room,
   and giving it one would put it in the same weight class as a warning. */
.alert-dot--info {
  background: var(--diele-fg-muted);
}
</style>
