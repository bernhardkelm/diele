import { z } from 'zod'
import { MAX_EXCLUDED_DOMAINS } from './domains.js'

/**
 * Visits one batch may carry. The portal reports what was just opened, a handful at most, and
 * every one of its urls may cost a probe; the extension may hand over what a browser saw while
 * offline, and none of its urls is probed.
 */
export const MAX_VISITS = { diele: 20, extension: 200 } as const

const visitSchema = z.object({
  // Generous on purpose: an over-long url is dropped quietly by the filter, the way any other
  // url not worth keeping is, rather than failing the batch it arrived in.
  url: z.string().min(1).max(8192),
  title: z.string().max(2000).optional(),
  at: z.iso.datetime({ offset: true }).optional(),
})

export const visitsSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('diele'),
    visits: z.array(visitSchema).max(MAX_VISITS.diele),
  }),
  z.object({
    source: z.literal('extension'),
    visits: z.array(visitSchema).max(MAX_VISITS.extension),
  }),
])

export const preferencesSchema = z.object({
  enabled: z.boolean().optional(),
  excludedDomains: z.array(z.string().max(300)).max(MAX_EXCLUDED_DOMAINS).optional(),
})
