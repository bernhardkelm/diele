<script setup lang="ts">
import { onMounted, ref, useTemplateRef } from 'vue'
import CheckBox from '@/components/CheckBox.vue'
import { useSession } from '@/composables/useSession'

interface CredentialFormProps {
  /** Asks for a new account rather than signing in to an existing one */
  setup?: boolean
  /** Focuses the first field once rendered; off where the form is not the point of the page */
  autofocus?: boolean
}

const props = defineProps<CredentialFormProps>()
const emit = defineEmits<{ done: [] }>()

const { signInWithPassword, completeSetup } = useSession()

const username = ref('')
const password = ref('')
const confirm = ref('')
const name = ref('')
const token = ref('')
const remember = ref(false)
const error = ref('')
const busy = ref(false)

const first = useTemplateRef<HTMLInputElement>('first')

// The control is behind a v-if until the mode is known, and a static autofocus attribute does
// not fire for an element that appears later.
onMounted(() => {
  if (props.autofocus) {
    first.value?.focus()
  }
})

/**
 * Signs in, or creates the first account, and reports what went wrong if anything did.
 * @returns {Promise<void>}
 */
async function submit(): Promise<void> {
  error.value = ''

  // Read once, up front: this prop follows `setupRequired`, which succeeding turns off, so
  // reading it after the await would always say the form was a sign-in.
  const isSetup = props.setup === true

  if (isSetup && password.value !== confirm.value) {
    error.value = 'the two passwords do not match'
    return
  }

  busy.value = true

  try {
    if (isSetup) {
      await completeSetup({
        username: username.value,
        password: password.value,
        name: name.value,
        token: token.value,
      })
    } else {
      await signInWithPassword({
        username: username.value,
        password: password.value,
        remember: remember.value,
      })
    }

    emit('done')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
    password.value = ''
    confirm.value = ''
  }
}
</script>

<template>
  <form class="credentials" @submit.prevent="submit">
    <label class="credentials__field">
      <span class="credentials__label">Username</span>
      <input
        ref="first"
        v-model="username"
        type="text"
        autocomplete="username"
        spellcheck="false"
        autocapitalize="none"
        required
      />
    </label>

    <label v-if="setup" class="credentials__field">
      <span class="credentials__label">Display name</span>
      <input v-model="name" type="text" autocomplete="name" placeholder="optional" />
    </label>

    <label class="credentials__field">
      <span class="credentials__label">Password</span>
      <input
        v-model="password"
        type="password"
        :autocomplete="setup ? 'new-password' : 'current-password'"
        required
      />
    </label>

    <label v-if="setup" class="credentials__field">
      <span class="credentials__label">Repeat password</span>
      <input v-model="confirm" type="password" autocomplete="new-password" required />
    </label>

    <label v-if="setup" class="credentials__field">
      <span class="credentials__label">Setup token</span>
      <input v-model="token" type="text" spellcheck="false" autocomplete="off" required />
      <span class="credentials__hint">printed by the server at startup</span>
    </label>

    <label v-else class="credentials__remember">
      <CheckBox v-model="remember" />
      <span>Stay signed in on this device</span>
    </label>

    <p v-if="error" class="credentials__error" role="alert">{{ error }}</p>

    <button type="submit" :disabled="busy">
      {{ setup ? 'Create account' : 'Sign in' }}
    </button>
  </form>
</template>

<style scoped>
.credentials {
  display: flex;
  flex-direction: column;
  gap: var(--diele-space-3);
  width: 100%;
  max-width: 22rem;
}

.credentials__field {
  display: flex;
  flex-direction: column;
  gap: var(--diele-space-1);
}

.credentials__label {
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--diele-fg-muted);
}

.credentials__hint {
  font-size: var(--diele-text-xs);
  color: var(--diele-fg-muted);
}

.credentials__remember {
  display: flex;
  align-items: center;
  gap: var(--diele-space-2);
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-sm);
  color: var(--diele-fg-muted);
  cursor: pointer;
}

.credentials__error {
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-sm);
  line-height: 1.5;
  color: var(--diele-status-down);
}
</style>
