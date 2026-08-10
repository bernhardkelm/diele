import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { cookieSecure, hexOr, parseTrustProxy, positiveInt } from '#configValues.js'

/**
 * Silences the warnings these helpers print, and reports how many there were, since warning
 * rather than throwing is the behaviour under test.
 * @returns {() => number} - Call to restore the console and read the count
 */
function captureWarnings(): () => number {
  const warn = mock.method(console, 'warn', () => {})

  return () => {
    const count = warn.mock.callCount()
    warn.mock.restore()
    return count
  }
}

test('an unset colour falls back without complaining', () => {
  const warnings = captureWarnings()

  assert.equal(hexOr('BRAND_ACCENT_LIGHT', undefined, '#16a34a'), '#16a34a')
  assert.equal(warnings(), 0)
})

test('a colour is accepted with or without its hash', () => {
  assert.equal(hexOr('BRAND_ACCENT_LIGHT', '#e8756a', '#16a34a'), '#e8756a')
  assert.equal(hexOr('BRAND_ACCENT_LIGHT', 'e8756a', '#16a34a'), '#e8756a')
})

// The case the optional hash exists for: `.env` reads an unquoted `#` as a comment, so the
// variable arrives set and empty rather than unset.
test('a value emptied by an unquoted hash warns rather than passing an empty colour through', () => {
  const warnings = captureWarnings()

  assert.equal(hexOr('BRAND_ACCENT_LIGHT', '', '#16a34a'), '#16a34a')
  assert.equal(warnings(), 1)
})

test('anything that is not a six-digit hex falls back', () => {
  const warnings = captureWarnings()

  for (const value of ['red', '#abc', '#12345', '#1234567', 'url(#x)', '#12345g']) {
    assert.equal(hexOr('BRAND_ACCENT_DARK', value, '#22c55e'), '#22c55e', value)
  }

  assert.equal(warnings(), 6)
})

test('an unset or auto cookie flag follows the origin', () => {
  for (const raw of [undefined, '', '  ', 'auto', 'AUTO']) {
    assert.equal(cookieSecure(raw, 'https://portal.example'), true, String(raw))
    assert.equal(cookieSecure(raw, 'http://localhost:5173'), false, String(raw))
  }
})

test('an explicit flag overrides the origin in both directions', () => {
  assert.equal(cookieSecure('false', 'https://portal.example'), false)
  assert.equal(cookieSecure('true', 'http://localhost:5173'), true)
  assert.equal(cookieSecure(' TRUE ', 'http://localhost:5173'), true)
})

// Falling back to the derivation rather than to a literal: a typo must not be what holds the
// cookie insecure on an https origin.
test('an unrecognised flag warns and derives from the origin', () => {
  const warnings = captureWarnings()

  assert.equal(cookieSecure('yes', 'https://portal.example'), true)
  assert.equal(cookieSecure('yes', 'http://localhost:5173'), false)
  assert.equal(warnings(), 2)
})

test('an unset proxy setting trusts nothing, which is what leaves the rate limiter a real key', () => {
  assert.equal(parseTrustProxy(undefined), false)
  assert.equal(parseTrustProxy(''), false)
  assert.equal(parseTrustProxy('   '), false)
  assert.equal(parseTrustProxy('false'), false)
  assert.equal(parseTrustProxy('off'), false)
  assert.equal(parseTrustProxy('OFF'), false)
})

test('a hop count arrives as a number', () => {
  assert.equal(parseTrustProxy('1'), 1)
  assert.equal(parseTrustProxy('0'), 0)
  assert.equal(parseTrustProxy(' 2 '), 2)
})

test('true and on trust every hop', () => {
  assert.equal(parseTrustProxy('true'), true)
  assert.equal(parseTrustProxy('on'), true)
})

// A subnet or one of express's own names is handed over as written, case included, since
// express does its own parsing of those.
test('anything else is passed through unchanged', () => {
  assert.equal(parseTrustProxy('loopback'), 'loopback')
  assert.equal(parseTrustProxy('10.0.0.0/8'), '10.0.0.0/8')
  assert.equal(parseTrustProxy('uniquelocal'), 'uniquelocal')
})

// A negative or fractional count is not a hop count, so it goes through as a string and lets
// express reject it, rather than silently becoming a trusted-hop number here.
test('a count that is not a whole number of hops is not treated as one', () => {
  assert.equal(parseTrustProxy('-1'), '-1')
  assert.equal(parseTrustProxy('1.5'), '1.5')
})

test('positiveInt an unset variable takes the default', () => {
  assert.equal(positiveInt('PORT', undefined, 3000), 3000)
})

test('positiveInt a whole number is read as written', () => {
  assert.equal(positiveInt('PORT', '8080', 3000), 8080)
  assert.equal(positiveInt('PORT', '  8080  ', 3000), 8080)
})

// `Number('')` is 0, which for a port means the OS picks one and the operator never learns
// which. Refusing to boot is the only way that gets noticed.
test('positiveInt a variable that is set but empty refuses to boot', () => {
  assert.throws(() => positiveInt('PORT', '', 3000), /set but empty/)
  assert.throws(() => positiveInt('PORT', '   ', 3000), /set but empty/)
})

// A NaN window reaches `datetime('now', '+NaN seconds')`, which is NULL against a NOT NULL
// column: the process boots healthy and every login 500s with nothing saying why.
test('positiveInt a value that is not a positive whole number refuses to boot', () => {
  for (const raw of ['abc', '0', '-1', '1.5', '1e4x', 'Infinity']) {
    assert.throws(() => positiveInt('SESSION_MAX_AGE_MS', raw, 1000), /positive whole number/, raw)
  }
})
