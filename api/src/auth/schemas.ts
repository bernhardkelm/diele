import { z } from 'zod'

/**
 * Reduces a username to the one form everything else uses: the value stored, the value looked
 * up, and the key the rate limiter counts against. Keeping that in one function is what stops
 * `Admin` and `admin` becoming two limiter buckets against a single account.
 * @param {string} raw - Username as typed
 * @returns {string} - Normalised username
 */
export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

// ASCII only, which is also what makes the database's COLLATE NOCASE index agree with the
// lowercasing above; NOCASE does not fold anything outside ASCII.
const username = z
  .string()
  .transform(normaliseUsername)
  .pipe(
    z
      .string()
      .min(3, 'must be at least 3 characters')
      .max(32)
      .regex(/^[a-z0-9][a-z0-9._-]*$/, 'must be a word without spaces'),
  )

// No composition rules: length is the only requirement that reliably buys anything, and a
// portal that demands a punctuation mark mostly collects passwords ending in `!`. The ceiling
// only bounds the work one request can ask for, since the body limit alone would allow a
// megabyte of input into the hash.
const password = z.string().min(12, 'must be at least 12 characters').max(256)

export const loginSchema = z.object({
  username,
  password: z.string().min(1),
  remember: z.boolean().optional().default(false),
})

export const setupSchema = z.object({
  username,
  password,
  name: z.string().trim().max(60).nullish(),
  token: z.string().min(1, 'the setup token is required'),
})

export type LoginInput = z.infer<typeof loginSchema>
export type SetupInput = z.infer<typeof setupSchema>
