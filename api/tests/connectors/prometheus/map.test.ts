import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readingOf } from '#connectors/prometheus/map.js'

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

// `up{job="x"}` matches an instance apiece, and Prometheus orders them however it likes, so the
// failing one has to decide from either position or the dot reports whichever was sent first.
test('one failing series in a vector turns the dot red from any position', () => {
  const first = readingOf({
    resultType: 'vector',
    result: [
      { metric: { instance: 'a' }, value: [1700000000, '0'] },
      { metric: { instance: 'b' }, value: [1700000000, '1'] },
    ],
  })
  const last = readingOf({
    resultType: 'vector',
    result: [
      { metric: { instance: 'a' }, value: [1700000000, '1'] },
      { metric: { instance: 'b' }, value: [1700000000, '0'] },
    ],
  })

  assert.equal(first?.state, 'down')
  assert.equal(last?.state, 'down')
  assert.equal(last?.detail, '1 of 2 series returned 0')
})

test('a vector whose every series answers is up', () => {
  const reading = readingOf({
    resultType: 'vector',
    result: [{ value: [1700000000, '1'] }, { value: [1700000000, '2'] }],
  })

  assert.equal(reading?.state, 'up')
  assert.equal(reading?.detail, '2 series returned non-zero')
})

// One series reporting NaN says nothing about the others, and dropping the reading entirely on
// account of it would lose what the rest of them did answer.
test('a series that is not a number is left out rather than deciding', () => {
  const reading = readingOf({
    resultType: 'vector',
    result: [{ value: [1700000000, 'NaN'] }, { value: [1700000000, '0'] }],
  })

  assert.equal(reading?.state, 'down')
  assert.equal(reading?.detail, 'query returned 0')
})
