import { z } from 'zod'

/** Cap on stored markup, shared with the import path so an export can always be read back */
export const MAX_SVG_BYTES = 64 * 1024

export const createIconSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** Raw markup; sanitised on the way into the database, never on the way out */
  svg: z.string().min(1).max(MAX_SVG_BYTES),
})

export type CreateIconInput = z.infer<typeof createIconSchema>
