import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Loads extension scripts the way a page or the worker does: classic scripts, one after another,
 * sharing one global scope. What they declare with `function` is then a property of the returned
 * context.
 * @param {string[]} files - Paths relative to the extension folder, in load order
 * @param {object} [globals] - What the scripts expect the browser to provide beyond the language
 * @returns {vm.Context} - The scope the scripts ran in
 */
export function loadScripts(files, globals = {}) {
  const context = vm.createContext({ URL, console, ...globals })

  for (const file of files) {
    vm.runInContext(readFileSync(`${ROOT}${file}`, 'utf8'), context, { filename: file })
  }

  return context
}

/** The filter as the worker loads it, without anything that touches chrome.* */
export const FILTER_FILES = [
  'history/hosts.js',
  'history/tokens.js',
  'history/searchPages.js',
  'history/filter.js',
]
