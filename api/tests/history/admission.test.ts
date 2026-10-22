import assert from 'node:assert/strict'
import { test } from 'node:test'
import { admitted } from '#history/admission.js'

// Each account within its own budget, together they would still make the resolver a scanner.
test('lookups are capped across the instance as well as per account', async () => {
  let lookups = 0
  const resolve = async (): Promise<ReadonlyArray<string>> => {
    lookups += 1
    return ['10.0.0.1']
  }

  for (let account = 0; account < 11; account += 1) {
    const urls = Array.from({ length: 60 }, (_, index) => `http://h${account}-${index}.internal/`)
    const kept = await admitted(`account-${account}`, urls, { resolve, exists: async () => false })

    // Past either budget a url is still kept unprobed, like any other name that is not public.
    assert.equal(kept.size, 60)
  }

  assert.equal(lookups, 600)
})
