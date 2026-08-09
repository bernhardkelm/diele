import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readingOf } from './map.js'

test('a non-zero sample is up', () => {
  const reading = readingOf({
    resultType: 'vector',
    result: [{ metric: { job: 'nextcloud' }, value: [1700000000, '1'] }],
  })

  assert.equal(reading?.state, 'up')
})

test('a zero sample is down', () => {
  const reading = readingOf({
    resultType: 'vector',
    result: [{ metric: { job: 'nextcloud' }, value: [1700000000, '0'] }],
  })

  assert.equal(reading?.state, 'down')
})

// `up{job="x"}` for a job that does not exist returns no samples, and so does a typo in a label.
// Neither says the service is failing.
test('an empty result leaves the dot off rather than turning it red', () => {
  assert.equal(readingOf({ resultType: 'vector', result: [] }), undefined)
})

test('a scalar answers the same way a vector does', () => {
  assert.equal(readingOf({ resultType: 'scalar', result: [1700000000, '1'] })?.state, 'up')
  assert.equal(readingOf({ resultType: 'scalar', result: [1700000000, '0'] })?.state, 'down')
})

test('a value that is not a number is no reading rather than a wrong one', () => {
  const reading = readingOf({ resultType: 'vector', result: [{ value: [1700000000, 'NaN'] }] })

  assert.equal(reading, undefined)
})

test('a payload carrying no result at all is no reading', () => {
  assert.equal(readingOf({}), undefined)
  assert.equal(readingOf({ resultType: 'vector' }), undefined)
})

// The detail is admin-only, and quoting the value is what makes a wrong query obvious.
test('the reading carries what the query actually returned', () => {
  const reading = readingOf({ resultType: 'vector', result: [{ value: [1700000000, '3'] }] })

  assert.equal(reading?.detail, 'query returned 3')
})
