import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  isUniqueConstraintError,
  notFound,
  tooManyRequests,
  unauthorized,
  unavailable,
} from '#errors.js'

test('every builder carries the status its name promises', () => {
  const cases: ReadonlyArray<[ApiError, number]> = [
    [badRequest('no'), 400],
    [unauthorized(), 401],
    [forbidden('no'), 403],
    [notFound(), 404],
    [conflict('no'), 409],
    [tooManyRequests('no'), 429],
    [unavailable('no'), 503],
  ]

  for (const [error, status] of cases) {
    assert.ok(error instanceof ApiError)
    assert.ok(error instanceof Error)
    assert.equal(error.status, status)
    assert.equal(error.name, 'ApiError')
  }
})

test('the two builders with a default still say something', () => {
  assert.equal(unauthorized().message, 'authentication required')
  assert.equal(notFound().message, 'not found')
  assert.equal(unauthorized('nope').message, 'nope')
  assert.equal(notFound('nope').message, 'nope')
})

test('a unique constraint is recognised, and nothing else is', () => {
  assert.equal(
    isUniqueConstraintError(new Error('UNIQUE constraint failed: slash_commands.keyword')),
    true,
  )
  assert.equal(isUniqueConstraintError(new Error('NOT NULL constraint failed')), false)
  assert.equal(isUniqueConstraintError('UNIQUE'), false)
  assert.equal(isUniqueConstraintError(undefined), false)
  assert.equal(isUniqueConstraintError(null), false)
})
