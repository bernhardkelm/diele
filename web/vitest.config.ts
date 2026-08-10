import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config.ts'

// Reuse the app's Vite config (vue() plugin + `@` alias + `?raw` SVG handling) so tests
// resolve modules exactly like the build does. Only the `test` block is test-specific.
export default mergeConfig(
  viteConfig,
  defineConfig({
    // Merged into the app's `@` rather than replacing it: vite unions two alias objects, and
    // falls into a reversed-precedence array merge if the two forms are mixed. Declared here
    // and not in vite.config.ts, because nothing the app builds imports a test.
    resolve: {
      alias: {
        '@tests': fileURLToPath(new URL('./tests', import.meta.url)),
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.ts'],
      exclude: [...configDefaults.exclude, 'dist/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      // Several composables here hold their state at module scope, which outlives the component
      // that read it. Running in a different order every time is what stops a test quietly
      // depending on what its predecessor left behind.
      sequence: {
        shuffle: true,
      },
      coverage: {
        provider: 'v8',
        reporter: ['text', 'text-summary'],
        include: ['src/**/*.{ts,vue}'],
        // main.ts is a 6-line bootstrap with nothing to assert, and the type-only modules carry
        // no runtime. The tests need no entry: `include` above covers `src/` alone.
        exclude: ['src/main.ts', 'src/types/**', 'env.d.ts'],
        thresholds: {
          lines: 80,
          statements: 80,
          branches: 80,
          functions: 80,
        },
      },
    },
  }),
)
