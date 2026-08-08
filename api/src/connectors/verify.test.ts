import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyConnector } from './verify.js'
import type { ConnectorModule } from './types.js'

const BASE: ConnectorModule = {
  type: 'stub',
  label: 'Stub',
  description: '',
  produces: ['row'],
  fields: [],
  secretKeys: ['token'],
  parseConfig: (input) => input as Record<string, unknown>,
}

// Not every source has a cheap way to be checked, and one that does not is saved rather than
// refused.
test('a module with no check of its own is stored as entered', async () => {
  await assert.doesNotReject(() => verifyConnector(BASE, {}, {}))
})

test('a check that passes is handed exactly the config and credentials being saved', async () => {
  const seen: Array<{ config: unknown; secrets: unknown }> = []
  const module: ConnectorModule = {
    ...BASE,
    verify: async ({ config, secrets }) => {
      seen.push({ config, secrets })
    },
  }

  await assert.doesNotReject(() =>
    verifyConnector(module, { baseUrl: 'https://gitlab.test' }, { token: 'glpat-secretvalue' }),
  )

  assert.deepEqual(seen, [
    { config: { baseUrl: 'https://gitlab.test' }, secrets: { token: 'glpat-secretvalue' } },
  ])
})

test('a check that fails names the connector and the reason', async () => {
  const module: ConnectorModule = {
    ...BASE,
    verify: async () => {
      throw new Error('the access token was rejected')
    },
  }

  await assert.rejects(() => verifyConnector(module, {}, {}), {
    status: 400,
    message: 'Stub could not be reached: the access token was rejected',
  })
})

// The message goes into an error the admin view renders, and a source tends to echo the
// request that caused the failure back at you.
test('a credential echoed by the source is stripped from the message', async () => {
  const module: ConnectorModule = {
    ...BASE,
    verify: async () => {
      throw new Error('PRIVATE-TOKEN glpat-secretvalue was rejected')
    },
  }

  await assert.rejects(() => verifyConnector(module, {}, { token: 'glpat-secretvalue' }), {
    message: 'Stub could not be reached: PRIVATE-TOKEN [redacted] was rejected',
  })
})
