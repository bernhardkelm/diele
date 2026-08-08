import { z } from 'zod'

/**
 * Returns whether a string is an absolute http(s) url. Only those two schemes: these values are
 * handed to the browser to open, so `javascript:` or `data:` here would put a script behind a
 * click on the portal's own page.
 * @param {string} value - Candidate url
 * @returns {boolean} - True when it parses and carries an http(s) scheme
 */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export const httpUrl = z.string().trim().min(1).refine(isHttpUrl, 'must be an absolute http(s) url')

// The template is turned into a url by substituting the term, so it has to be a valid url before
// substitution and has to say where the term goes.
export const queryTemplate = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.includes('{query}'), 'must contain the {query} placeholder')
  .refine((value) => isHttpUrl(value.replace('{query}', 'x')), 'must be an absolute http(s) url')

// Written into a css custom property, so anything but a plain hex would escape into the rule.
export const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a 6-digit hex colour')

// Belongs to no one feature: four routers reorder rows and all of them take this same body.
export const reorderSchema = z.object({
  /** Ids in their new order; positions are rewritten to match */
  ids: z.array(z.number().int().positive()).min(1),
})
