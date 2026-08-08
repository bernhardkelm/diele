import { createApp } from 'vue'
import App from './App.vue'
import { initTheme } from '@/composables/useTheme'
// Latin subsets only: the portal has no cyrillic, greek or vietnamese copy, and the full
// entrypoints ship those faces too. Weights are the ones the styles actually ask for, so an
// unloaded weight can never fall back to a synthesised one.
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/space-grotesk/latin-700.css'
import '@fontsource/geist-mono/latin-400.css'
import '@fontsource/geist-mono/latin-600.css'
import '@/styles/tokens.css'
import '@/styles/base.css'

// before mount, so a pinned theme is on the document for the first paint
initTheme()

const app = createApp(App)

// A throw inside a render or a watcher is otherwise swallowed by the framework, which leaves a
// half-painted portal and nothing in the console saying why.
app.config.errorHandler = (error, _instance, info) => {
  console.error(`[diele] ${info}:`, error)
}

app.mount('#app')
