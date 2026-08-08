import { z } from 'zod'
import { hexColor, httpUrl } from '#fieldSchemas.js'

export const linkKindSchema = z.enum(['card', 'site'])

const keywords = z.array(z.string().trim().min(1).max(60)).max(40)

// Shared by both schemas so they cannot drift, and carrying no defaults of its own: a default
// survives `.partial()` as a value the parse fills in, which would leave an update writing a
// field the request never mentioned.
const fields = {
  label: z.string().trim().min(1).max(120),
  url: httpUrl,
  display: z.string().trim().max(120).nullish(),
  iconId: z.number().int().positive().nullish(),
  color: hexColor.nullish(),
}

export const createLinkSchema = z.object({
  kind: linkKindSchema,
  ...fields,
  keywords: keywords.default([]),
})

// Every field optional, but at least one present, so an empty body is a mistake rather than a
// silent no-op that still bumps updated_at.
export const updateLinkSchema = z
  .object({ ...fields, keywords })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'no fields to update')

export type CreateLinkInput = z.infer<typeof createLinkSchema>
export type UpdateLinkInput = z.infer<typeof updateLinkSchema>
