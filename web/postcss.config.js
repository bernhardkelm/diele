import { fileURLToPath, URL } from 'node:url'

import postcssGlobalData from '@csstools/postcss-global-data'
import postcssCustomMedia from 'postcss-custom-media'

// global-data first, so the @custom-media definitions are in scope before custom-media
// compiles them away; resolved from this file, cwd differs between vite and vitest runs
export default {
  plugins: [
    postcssGlobalData({
      files: [fileURLToPath(new URL('./src/styles/media.css', import.meta.url))],
    }),
    postcssCustomMedia(),
  ],
}
