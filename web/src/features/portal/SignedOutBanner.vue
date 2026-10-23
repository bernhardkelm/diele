<script setup lang="ts">
interface SignedOutBannerProps {
  /** Whether the session behind the painted portal has ended, which is all that draws the line */
  lapsed: boolean
}

defineProps<SignedOutBannerProps>()
const emit = defineEmits<{ signIn: [] }>()
</script>

<template>
  <!-- The region stands whether or not there is anything in it, so the line appearing is a change
       to a live region a screen reader already knows about rather than a new one it may not
       announce. Polite for the reason the alerts are: nothing on screen is wrong yet, it is only
       last visit's copy. -->
  <div class="signed-out" role="status">
    <p v-if="lapsed" class="signed-out__line">
      <span class="signed-out__name">Signed out</span>
      <span class="signed-out__detail truncate">showing what this browser last saw</span>
      <button type="button" class="signed-out__action" @click="emit('signIn')">sign in</button>
    </p>
  </div>
</template>

<style scoped>
.signed-out {
  width: 100%;
  max-width: var(--diele-content-width);
}

/* Empty, the region leaves the column, or the page's gap would open around a line that is not
   there. Out of the flow rather than hidden, since a hidden region is no longer one. */
.signed-out:empty {
  position: absolute;
}

/* The line the alerts draw above the field, so a lapse reads as one more thing the portal is
   telling you rather than as a dialog standing in front of it. */
.signed-out__line {
  display: flex;
  align-items: baseline;
  gap: var(--diele-space-4);
  margin: 0;
  padding: var(--diele-space-2) 0;
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-sm);
  color: var(--diele-fg-muted);
  border-bottom: 3px solid var(--diele-rule);
}

.signed-out__name {
  flex: none;
  color: var(--diele-status-pending);
  font-weight: 600;
}

.signed-out__detail {
  flex: 1;
}

/* Ends on the section's right edge where the alerts put their times, and stays shown rather than
   appearing on hover: it is the one thing the line is for. */
.signed-out__action {
  flex: none;
  color: var(--diele-fg);
}

.signed-out__action:focus-visible {
  color: var(--diele-accent);
  text-decoration: underline;
  outline: none;
}
</style>
