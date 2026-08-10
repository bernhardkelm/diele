import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// A filesystem path for a child process, not a module specifier `#config.js` could stand in for
const CONFIG = fileURLToPath(new URL('../src/config.ts', import.meta.url))

interface BootResult {
  readonly ok: boolean
  readonly output: string
}

/**
 * Loads `config` in a process of its own under the given environment. It reads the environment
 * once at module load, so a test that wants a different one needs a different process.
 * @param {Record<string, string>} env - Environment to load it under
 * @returns {BootResult} - Whether it loaded, and everything it printed
 */
function loadConfig(env: Record<string, string>): BootResult {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--conditions=development', '-e', `import(${JSON.stringify(CONFIG)})`],
    {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    },
  )

  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` }
}

test('the configuration loads under an ordinary environment', () => {
  assert.equal(loadConfig({}).ok, true)
})

// The check exists so a deployment that means to use an issuer cannot start without one and
// quietly fall back to holding its own accounts instead.
test('oidc mode without an issuer refuses to boot, and says which variable is missing', () => {
  const result = loadConfig({ AUTH_MODE: 'oidc', OIDC_ISSUER: '', OIDC_CLIENT_ID: '' })

  assert.equal(result.ok, false)
  assert.match(result.output, /OIDC_ISSUER must be set when AUTH_MODE=oidc/)
})

test('oidc mode with every required variable loads', () => {
  const result = loadConfig({
    AUTH_MODE: 'oidc',
    OIDC_ISSUER: 'https://sso.invalid/',
    OIDC_CLIENT_ID: 'diele',
    OIDC_CLIENT_SECRET: 'secret',
  })

  assert.equal(result.ok, true)
})

// `Number('')` is 0, which would have the app listen on a port the OS picked and nobody chose.
test('a port that is set but empty refuses to boot rather than picking one at random', () => {
  const result = loadConfig({ PORT: ' ' })

  assert.equal(result.ok, false)
  assert.match(result.output, /PORT is set but empty/)
})

// A NaN window reaches `datetime('now', '+NaN seconds')`, which is NULL against a NOT NULL
// column: the process boots healthy and every login 500s with nothing saying why.
test('a session window that is not a number refuses to boot rather than failing every login', () => {
  const result = loadConfig({ SESSION_MAX_AGE_MS: 'one day' })

  assert.equal(result.ok, false)
  assert.match(result.output, /SESSION_MAX_AGE_MS=one day is not a positive whole number/)
})

// The fallback is deliberate: `local` needs nothing configured and still holds the door, since
// the first account is created through a token-gated form. It says so rather than doing it
// silently, because someone who meant to type `oidc` has to find out.
test('an unknown auth mode falls back to local and says so', () => {
  const result = loadConfig({ AUTH_MODE: 'oicd' })

  assert.equal(result.ok, true)
  assert.match(result.output, /AUTH_MODE=oicd is not a known mode, falling back to local/)
})
