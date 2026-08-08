import { z } from 'zod'
import { queryTemplate } from '#fieldSchemas.js'

// The word typed after the slash. No slash of its own, so `/r/vuejs` stays a subreddit jump
// rather than being read as a command called `r/vuejs`.
const keyword = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'must be a word without slashes or spaces')

export const createCommandSchema = z.object({
  keyword,
  label: z.string().trim().max(60).nullish(),
  urlTemplate: queryTemplate,
})

export const updateCommandSchema = createCommandSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'no fields to update')

export type CreateCommandInput = z.infer<typeof createCommandSchema>
export type UpdateCommandInput = z.infer<typeof updateCommandSchema>
