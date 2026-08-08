import { z } from 'zod'
import { queryTemplate } from '#fieldSchemas.js'

export const createEngineSchema = z.object({
  name: z.string().trim().min(1).max(60),
  urlTemplate: queryTemplate,
})

export const updateEngineSchema = createEngineSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'no fields to update')

export type CreateEngineInput = z.infer<typeof createEngineSchema>
export type UpdateEngineInput = z.infer<typeof updateEngineSchema>
