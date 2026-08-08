import { argon2, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(argon2)

// OWASP's current minimum for argon2id. Held here rather than read from the environment: a
// value low enough to matter would be a silent weakening, and raising it is a code change
// that also has to think about the stored hashes below.
const PARAMS = {
  memory: 19456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
} as const

const NONCE_BYTES = 16

// The argon2 revision the format encodes, which is what `$v=19$` means in every other
// implementation's output. Node has no knob for it, so it is written for readers, not for us.
const ARGON2_VERSION = 19

/**
 * Derives a hash for a password.
 *
 * The result carries its own algorithm and cost, so a later change to `PARAMS` is a rehash on
 * next login rather than a migration, and an old hash stays verifiable in the meantime.
 * @param {string} plain - Password as typed
 * @returns {Promise<string>} - Encoded hash, safe to store
 */
export async function hashPassword(plain: string): Promise<string> {
  const nonce = randomBytes(NONCE_BYTES)
  const tag = await derive('argon2id', { message: plain, nonce, ...PARAMS })

  const cost = `m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}`

  return [
    'argon2id',
    `v=${ARGON2_VERSION}`,
    cost,
    nonce.toString('base64'),
    Buffer.from(tag).toString('base64'),
  ].join('$')
}

/**
 * Returns whether a password matches a stored hash, re-deriving with the parameters that hash
 * was written with rather than the current ones.
 * @param {string} plain - Password as typed
 * @param {string} stored - Encoded hash from the database
 * @returns {Promise<boolean>} - True when the password matches
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parsed = parse(stored)
  if (!parsed) {
    return false
  }

  const tag = await derive('argon2id', {
    message: plain,
    nonce: parsed.nonce,
    tagLength: parsed.expected.length,
    memory: parsed.memory,
    passes: parsed.passes,
    parallelism: parsed.parallelism,
  })

  const derived = Buffer.from(tag)
  if (derived.length !== parsed.expected.length) {
    return false
  }

  return timingSafeEqual(derived, parsed.expected)
}

// Verified against when the username is unknown, so a name nobody holds costs the same time as
// a name with the wrong password. Without it the endpoint answers faster for one than the
// other, which is enough to enumerate accounts.
let dummy: Promise<string> | null = null

/**
 * Spends the same work a real verification would, for a username that does not exist.
 * @param {string} plain - Password as typed, so the work matches its length
 * @returns {Promise<void>}
 */
export async function spendDummyVerify(plain: string): Promise<void> {
  dummy ??= hashPassword(randomBytes(32).toString('base64'))
  await verifyPassword(plain, await dummy)
}

interface ParsedHash {
  readonly memory: number
  readonly passes: number
  readonly parallelism: number
  readonly nonce: Buffer
  readonly expected: Buffer
}

/**
 * Reads an encoded hash back into the parameters it was written with.
 * @param {string} stored - Encoded hash from the database
 * @returns {ParsedHash | undefined} - Its parts, or undefined when the string is not one
 */
function parse(stored: string): ParsedHash | undefined {
  const [algorithm, , cost, nonce, tag] = stored.split('$')
  if (algorithm !== 'argon2id' || !cost || !nonce || !tag) {
    return undefined
  }

  const costs = new Map(
    cost.split(',').map((pair) => {
      const [key, value] = pair.split('=')
      return [key, Number(value)]
    }),
  )

  const memory = costs.get('m')
  const passes = costs.get('t')
  const parallelism = costs.get('p')

  if (!memory || !passes || !parallelism) {
    return undefined
  }

  return {
    memory,
    passes,
    parallelism,
    nonce: Buffer.from(nonce, 'base64'),
    expected: Buffer.from(tag, 'base64'),
  }
}
