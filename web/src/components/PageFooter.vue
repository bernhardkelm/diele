<script setup lang="ts">
import { readInjectedVersion } from '@/helpers/injectedRuntime'

// Where the thing running this page is written down, for whoever opens it and wonders what it
// is. The host it used to name said nothing nobody in the address bar could already see.
const DOCS_URL = 'https://github.com/bernhardkelm/diele'

// Read once rather than held reactive: a running process serves one build, and the document it
// served says which. The dev server stamps none, so nothing is named there.
const version = readInjectedVersion()
</script>

<template>
  <footer class="page-footer">
    <span v-if="version" class="page-footer__version">{{ version }}</span>

    <a class="page-footer__link" :href="DOCS_URL" target="_blank" rel="noreferrer noopener">
      docs
    </a>
  </footer>
</template>

<style scoped>
/* Sits at the bottom of whichever shell holds it: `view-shell` is a full-height column, so the
   auto margin is what puts this under the content rather than after it. */
.page-footer {
  display: flex;
  gap: var(--diele-space-3);
  align-items: baseline;
  margin-top: auto;
  font-size: var(--diele-text-md);
  letter-spacing: 0.04em;
  color: var(--diele-fg-muted);
}

/* Set apart from the link beside it, which is the one thing here that is reachable. */
.page-footer__version {
  opacity: 0.7;
}

.page-footer__link {
  color: inherit;
  text-decoration: none;
}

.page-footer__link:hover,
.page-footer__link:focus-visible {
  color: var(--diele-fg);
}
</style>
