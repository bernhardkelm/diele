import type { ApiBrand } from '@diele/common'

/** The names the api writes the metas under, so neither side may rename one alone. */
const BRAND_META = 'diele:brand'
const VERSION_META = 'diele:version'

/**
 * Reads a meta the api stamped into the served document. Absent under the dev server, which
 * serves `index.html` itself, and on a document served by a build that predates them.
 * @param {string} name - Meta name to read
 * @returns {string | undefined} - Its content, or undefined when the meta is absent or empty
 */
function readMeta(name: string): string | undefined {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)

  return meta?.content || undefined
}

/**
 * Reads the brand the api stamped into the served document.
 *
 * This is what the login screen paints in. Everything behind it starts from the cached
 * configuration, which is already on the document before the first paint; the gate has no cache,
 * because signing out is what clears it, and it would otherwise show the defaults until the
 * providers endpoint answered.
 * @returns {ApiBrand | undefined} - The stamped brand, or undefined when there is none to read
 */
export function readInjectedBrand(): ApiBrand | undefined {
  const content = readMeta(BRAND_META)
  if (!content) {
    return undefined
  }

  try {
    const parsed = JSON.parse(content) as Partial<ApiBrand>

    // Only the two the header renders are required. The accents are checked by whoever applies
    // them, which is the same check the cached brand goes through.
    if (typeof parsed.title !== 'string' || typeof parsed.subtitle !== 'string') {
      return undefined
    }

    return parsed as ApiBrand
  } catch {
    return undefined
  }
}

/**
 * Reads the build this portal is running, as `/status` reports it. Taken from the document
 * rather than the endpoint, so naming it in the footer costs no request.
 * @returns {string | undefined} - The version, or undefined when there is none to read
 */
export function readInjectedVersion(): string | undefined {
  return readMeta(VERSION_META)
}
