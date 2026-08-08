import type { ApiBrand } from '@diele/common'

const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * Applies the configured accent to the token layer, as one `light-dark()` pair so both themes
 * resolve from the same declaration and the existing override keeps working.
 *
 * Both values are checked here as well as on the server, because this one can also arrive
 * from the localStorage cache, which is not a trusted source.
 * @param {ApiBrand} brand - Brand as the API serves it
 * @returns {void}
 */
export function applyBrandAccent(brand: ApiBrand): void {
  const { accentLight, accentDark } = brand
  if (!HEX.test(accentLight ?? '') || !HEX.test(accentDark ?? '')) {
    return
  }

  document.documentElement.style.setProperty(
    '--diele-accent',
    `light-dark(${accentLight}, ${accentDark})`,
  )
}
