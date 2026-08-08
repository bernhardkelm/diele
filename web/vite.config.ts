import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import dotenv from 'dotenv'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

const packageRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(packageRoot, '..')

// The same four files, in the same order, as `api/src/config.ts` - so one documented precedence
// covers both halves rather than each resolving its settings its own way. Most specific first:
// the nearest scope wins outright, and within a scope the untracked file beats the committed one.
//
// Loaded into a plain object rather than `process.env`, because this is a build tool reading its
// own configuration and has no business mutating the environment.
//
// Not vite's own `loadEnv`: that reads a single directory, so it cannot express a package file
// outranking a repo-wide one.
const fileEnv: Record<string, string> = {}
dotenv.config({
  path: [
    resolve(packageRoot, '.env.local'),
    resolve(packageRoot, '.env'),
    resolve(repoRoot, '.env.local'),
    resolve(repoRoot, '.env'),
  ],
  processEnv: fileEnv,
  quiet: true,
})

// Where the api is listening. Only the origin differs between machines; the paths are the same
// ones a deployment serves, so the browser talks to one origin either way and the session
// cookie stays first-party.
const apiTarget = process.env.VITE_API_TARGET ?? fileEnv.VITE_API_TARGET ?? 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools()],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
