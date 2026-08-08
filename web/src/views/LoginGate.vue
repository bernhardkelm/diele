<script setup lang="ts">
import { onMounted } from 'vue'
import CredentialForm from '@/components/CredentialForm.vue'
import PortalHeader from '@/components/PortalHeader.vue'
import { useSession } from '@/composables/useSession'

const { brand, providers, mode, setupRequired, signIn, loadProviders } = useSession()

onMounted(() => void loadProviders())
</script>

<template>
  <div class="gate view-shell">
    <PortalHeader :title="brand.title" :subtitle="setupRequired ? 'setup' : brand.subtitle" />

    <!-- Nothing is drawn until the mode is known: guessing would paint the sign-in button and
         then replace it with a form, having already moved focus to a control that is gone. -->
    <template v-if="mode === 'local'">
      <p v-if="setupRequired" class="gate__lede">
        This portal has no account yet. Create the first one to claim it.
      </p>

      <CredentialForm :setup="setupRequired" autofocus />
    </template>

    <button v-else-if="mode" type="button" autofocus @click="signIn()">
      Sign in{{ providers[0] ? ` with ${providers[0].name}` : '' }}
    </button>

    <div v-else class="gate__placeholder" aria-hidden="true" />
  </div>
</template>

<style scoped>
.gate {
  justify-content: center;
}

.gate__lede {
  max-width: 26rem;
  margin-bottom: calc(var(--diele-space-4) * -1);
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-md);
  line-height: 1.6;
  text-align: center;
  color: var(--diele-fg-muted);
}

/* Holds the height the button or the form will take, so settling on one does not jump the
   lockup up the page. */
.gate__placeholder {
  height: 2.6rem;
}
</style>
