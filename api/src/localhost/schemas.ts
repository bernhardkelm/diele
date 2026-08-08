import { z } from 'zod'

const scheme = z.enum(['http', 'https'])
const port = z.coerce.number().int().min(1).max(65535)
const keywords = z.array(z.string().trim().min(1).max(60)).max(20)

export const createLocalhostSchema = z.object({
  scheme: scheme.default('https'),
  port,
  keywords: keywords.default([]),
})

// Built from the bare fields rather than from the create schema: a default survives
// `.partial()` as a value the parse fills in, so an update would reset the scheme and clear the
// keywords of a row whose request named neither.
export const updateLocalhostSchema = z
  .object({ scheme, port, keywords })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'no fields to update')

export type CreateLocalhostInput = z.infer<typeof createLocalhostSchema>
export type UpdateLocalhostInput = z.infer<typeof updateLocalhostSchema>
