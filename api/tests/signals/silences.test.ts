import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { getDb } from '#db/index.js'
import { readSilenced, setSilenced, sweepSilences } from '#signals/silences.js'

const ADMIN = 1
const MEMBER = 2

beforeEach(() => {
  getDb().prepare('DELETE FROM signal_silences').run()
})

test('an admin quietens a line for the whole portal', () => {
  setSilenced('4:abc', ADMIN, true, true)

  assert.ok(readSilenced(ADMIN).has('4:abc'))
  assert.ok(readSilenced(MEMBER).has('4:abc'))
})

test('anyone else quietens it only for themselves', () => {
  setSilenced('4:abc', MEMBER, false, true)

  assert.ok(readSilenced(MEMBER).has('4:abc'))
  assert.ok(!readSilenced(ADMIN).has('4:abc'))
})

test('bringing one back leaves the other scope standing', () => {
  setSilenced('4:abc', ADMIN, true, true)
  setSilenced('4:abc', MEMBER, false, true)

  // The portal's is lifted; what the member did for themselves is still theirs.
  setSilenced('4:abc', ADMIN, true, false)

  assert.ok(!readSilenced(ADMIN).has('4:abc'))
  assert.ok(readSilenced(MEMBER).has('4:abc'))
})

test('a member cannot lift what the portal silenced', () => {
  setSilenced('4:abc', ADMIN, true, true)
  setSilenced('4:abc', MEMBER, false, false)

  assert.ok(readSilenced(MEMBER).has('4:abc'))
})

test('silencing twice is not an error and does not double up', () => {
  setSilenced('4:abc', MEMBER, false, true)
  setSilenced('4:abc', MEMBER, false, true)

  assert.equal(readSilenced(MEMBER).size, 1)
})

// A silence lasts as long as its alert. Saying you know about this outage is not saying you want
// to be kept from hearing about the next one.
test('a condition that stopped firing loses its silence', () => {
  setSilenced('4:gone', MEMBER, false, true)
  setSilenced('4:still', MEMBER, false, true)

  sweepSilences(4, ['4:still'])

  assert.deepEqual([...readSilenced(MEMBER)], ['4:still'])
})

test('a source answering nothing clears its own silences and nobody else’s', () => {
  setSilenced('4:one', MEMBER, false, true)
  setSilenced('9:one', MEMBER, false, true)

  sweepSilences(4, [])

  assert.deepEqual([...readSilenced(MEMBER)], ['9:one'])
})

// Ids are namespaced by connector, and one source's run says nothing about another's.
test('a sweep leaves other sources alone', () => {
  setSilenced('4:one', MEMBER, false, true)
  setSilenced('44:one', MEMBER, false, true)

  sweepSilences(4, ['4:one'])

  assert.deepEqual([...readSilenced(MEMBER)].sort(), ['4:one', '44:one'].sort())
})

test('a sweep takes both scopes with it, since the alert is gone for everyone', () => {
  setSilenced('4:gone', ADMIN, true, true)
  setSilenced('4:gone', MEMBER, false, true)

  sweepSilences(4, [])

  assert.equal(readSilenced(ADMIN).size, 0)
  assert.equal(readSilenced(MEMBER).size, 0)
})
