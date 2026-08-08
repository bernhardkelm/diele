import { createApp } from 'vue'
import App from './App.vue'
import { initTheme } from '@/composables/useTheme'
import { dropEarlyKeys } from '@/helpers/earlyKeys'
import '@/styles/fonts.css'
import '@/styles/tokens.css'
import '@/styles/base.css'

// The inline script in index.html has already stamped a pinned theme, early enough for the first
// paint. This is the same read from the module that owns it, and what still applies if that
// script is ever dropped or refused.
initTheme()

const app = createApp(App)

// A throw inside a render or a watcher is otherwise swallowed by the framework, which leaves a
// half-painted portal and nothing in the console saying why.
app.config.errorHandler = (error, _instance, info) => {
  console.error(`[diele] ${info}:`, error)
}

app.mount('#app')

// Whatever mounted, the pre-mount capture is finished with. A run that ended on the login gate
// has no field to replay into, and one left running would collect the password typed there.
dropEarlyKeys()
