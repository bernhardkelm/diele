/**
 * Every path the portal navigates to, built here rather than typed at the call site. The hash
 * layout is then one file's business: restructuring or localising a segment does not mean
 * finding every template that spelled it out.
 */
export const ROUTES = {
  portal: '/',
  admin: '/admin',
  settings: '/settings',
  styleguide: '/styleguide',
} as const

/**
 * Builds the path that opens one section of the admin view.
 * @param {string} section - Feature to expand
 * @returns {string} - Path for the hash
 */
export function adminSection(section: string): string {
  return `${ROUTES.admin}/${section}`
}

/**
 * Builds the path that opens one section of the settings view.
 * @param {string} section - Section to expand
 * @returns {string} - Path for the hash
 */
export function settingsSection(section: string): string {
  return `${ROUTES.settings}/${section}`
}
