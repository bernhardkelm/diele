import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginOxlint from 'eslint-plugin-oxlint'
import skipFormatting from 'eslint-config-prettier/flat'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  ...pluginOxlint.buildFromOxlintConfigFile('.oxlintrc.json'),

  skipFormatting,

  // After skipFormatting, which would otherwise be free to switch it off again. `curly` is a
  // correctness rule here rather than a formatting one: an unbraced body silently drops the
  // second statement out of the branch when one is added.
  {
    name: 'app/rules',
    rules: {
      curly: ['error', 'all'],
      // v-html launders any string through Vue's own Trusted Types policy, which the api's header
      // has to allow for compiled templates; markup goes through v-svg and its `diele-svg` instead.
      'vue/no-v-html': 'error',
    },
  },
)
