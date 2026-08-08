<script setup lang="ts">
import { computed } from 'vue'
import type { ServiceState, ServiceStatus } from '@/helpers/uptime'

interface StatusDotProps {
  status: ServiceStatus
  /** Service name, used to build the screen reader label */
  name: string
}

const props = defineProps<StatusDotProps>()

const WORDING: Record<ServiceState, string> = {
  up: 'up',
  down: 'down',
  pending: 'pending',
  maintenance: 'in maintenance',
}

const label = computed(() => {
  const state = `${props.name}: ${WORDING[props.status.state]}`
  if (props.status.uptime === undefined) {
    return state
  }
  return `${state}, ${(props.status.uptime * 100).toFixed(2)}% uptime over 24h`
})
</script>

<template>
  <span class="status" :class="`status--${status.state}`" :title="label">
    <span class="status__label">{{ label }}</span>
  </span>
</template>

<style scoped>
/* Layout is the caller's business: the card pins it to a corner, the site row keeps it in
   the text flow. This only draws the dot. */
.status {
  display: inline-block;
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--diele-fg-muted);
}

/* halo weight differs per state, so the dot does not rely on hue alone */
.status--up {
  background: var(--diele-status-up);
}

.status--down {
  background: var(--diele-status-down);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--diele-status-down) 30%, transparent);
}

.status--pending {
  background: var(--diele-status-pending);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--diele-status-pending) 25%, transparent);
}

.status--maintenance {
  background: var(--diele-status-maintenance);
}

.status__label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
