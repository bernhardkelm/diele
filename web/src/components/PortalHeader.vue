<script setup lang="ts">
import BrandTilde from '@/components/BrandTilde.vue'
import { ROUTES } from '@/composables/routes'
import { useHashRoute } from '@/composables/useHashRoute'

interface PortalHeaderProps {
  title: string
  subtitle: string
}

defineProps<PortalHeaderProps>()

const { go } = useHashRoute()
</script>

<template>
  <header class="brand">
    <h1 class="brand__title">
      <button
        class="brand__home"
        type="button"
        aria-label="Back to the portal"
        @click="go(ROUTES.portal)"
      >
        {{ title }}<BrandTilde class="brand__tilde" />
      </button>
    </h1>
    <p class="brand__subtitle">{{ subtitle }}</p>
  </header>
</template>

<style scoped>
.brand {
  text-align: center;
}

/* the button inside is a block box, so the header's text-align cannot centre it; the title
   has to do the centring itself */
.brand__title {
  display: flex;
  justify-content: center;
  margin: 0;
}

.brand__home {
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--diele-font-brand);
  font-size: var(--diele-text-display);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.05em;
  color: var(--diele-wordmark);
}

/* the accent rather than the underline every other control hovers with, the way the launcher's
   glyph takes it: a rule under the lockup reads as a link */
.brand__home:hover:not(:disabled) {
  color: var(--diele-accent);
  text-decoration: none;
}

/* The one real focus ring in the portal, deliberately. Everywhere else focus is a row in a
   list, where the marker glyph and the accent colour already say which one is current; the
   wordmark stands alone above that grammar with nothing next to it to read against. */
.brand__home:focus-visible {
  outline: 2px solid var(--diele-accent);
  outline-offset: 4px;
  border-radius: 4px;
}

/* nudged in em, so the lockup holds together as the title scales with the viewport; the
   top offset seats the mark on the x-height rather than the baseline */
.brand__tilde {
  margin-left: 0.17em;
  margin-top: 0.22em;
}

.brand__subtitle {
  margin: var(--diele-space-2) 0 0;
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-sm);
  text-transform: uppercase;
  /* the tracking opens a gap after the last letter, which the offset pulls back so the
     word stays optically centred under the lockup */
  letter-spacing: 7px;
  text-indent: 7px;
  color: var(--diele-subtitle);
}
</style>
