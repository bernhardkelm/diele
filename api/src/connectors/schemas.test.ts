import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ApiFieldSpec } from '@diele/common'
import { ApiError } from '#errors.js'
import {
  requireModule,
  requireSecrets,
  splitConnectorBody,
  toAdminRow,
} from '#connectors/schemas.js'
import type { ConnectorRecord } from '#connectors/repository.js'
import type { ConnectorModule } from '#connectors/types.js'

const FIELDS: ReadonlyArray<ApiFieldSpec> = [
  { key: 'baseUrl', label: 'Instance', input: 'url', required: true },
  { key: 'groups', label: 'Groups', input: 'keywords' },
  { key: 'token', label: 'Access token', input: 'secret', required: true },
  { key: 'includeSubgroups', label: 'Include subgroups', input: 'toggle' },
]

const module: ConnectorModule = {
  type: 'fake',
  label: 'Fake',
  description: 'A module that exists only to describe fields',
  produces: ['row'],
  fields: FIELDS,
  secretKeys: ['token'],
  parseConfig: (input) => input as Record<string, unknown>,
}

test('a registered type resolves and an unregistered one is a bad request', () => {
  assert.equal(requireModule('gitlab').type, 'gitlab')

  for (const type of ['nope', 'GITLAB', '']) {
    assert.throws(
      () => requireModule(type),
      (error: unknown) => error instanceof ApiError && error.status === 400,
      type,
    )
  }
})

test('the flat form body is sorted into columns, config and credentials', () => {
  const body = splitConnectorBody(module, {
    label: '  Work  ',
    syncIntervalSeconds: '900',
    baseUrl: 'https://gitlab.example',
    groups: ['a', 'b'],
    includeSubgroups: false,
    token: 'glpat-secret',
  })

  assert.equal(body.label, 'Work')
  assert.equal(body.syncIntervalSeconds, 900)
  assert.deepEqual(body.config, {
    baseUrl: 'https://gitlab.example',
    groups: ['a', 'b'],
    includeSubgroups: false,
  })
  assert.deepEqual(body.secrets, { token: 'glpat-secret' })
})

// Keys come from the module, so a value cannot be smuggled into the secret store or the config
// under a name nothing declares.
test('a key the module does not declare is dropped rather than stored', () => {
  const body = splitConnectorBody(module, {
    baseUrl: 'https://gitlab.example',
    somethingElse: 'ignored',
    __proto__: { polluted: true },
    otherSecret: 'also ignored',
  })

  assert.deepEqual(Object.keys(body.config), ['baseUrl'])
  assert.deepEqual(body.secrets, {})
})

// The form never shows a stored credential, so it submits an empty box for one already set:
// empty has to mean "leave it alone" rather than "clear it".
test('an empty credential box leaves the stored one standing', () => {
  for (const token of ['', '   ']) {
    const body = splitConnectorBody(module, { token })

    assert.deepEqual(body.secrets, {}, JSON.stringify(token))
  }
})

test('a credential is trimmed, since a pasted token usually carries a newline', () => {
  const body = splitConnectorBody(module, { token: '  glpat-secret\n' })

  assert.deepEqual(body.secrets, { token: 'glpat-secret' })
})

// Dropping an empty field is what lets the module's own `.default()` stand, so the placeholder
// a form advertises is what actually gets stored.
test('an empty config field is dropped, but false and zero are values', () => {
  const body = splitConnectorBody(module, {
    baseUrl: '',
    groups: null,
    includeSubgroups: false,
  })

  assert.deepEqual(body.config, { includeSubgroups: false })
})

test('a body that is not an object is refused', () => {
  for (const body of [null, 'string', 42, ['a'], undefined]) {
    assert.throws(
      () => splitConnectorBody(module, body),
      (error: unknown) => error instanceof ApiError && error.status === 400,
      JSON.stringify(body),
    )
  }
})

test('a label and an interval are validated rather than taken as written', () => {
  assert.throws(() => splitConnectorBody(module, { label: '' }))
  assert.throws(() => splitConnectorBody(module, { label: 'x'.repeat(81) }))
  // An hour is long enough to be polite to a source, a minute short enough to test with.
  assert.throws(() => splitConnectorBody(module, { syncIntervalSeconds: 59 }))
  assert.throws(() => splitConnectorBody(module, { syncIntervalSeconds: 24 * 60 * 60 + 1 }))

  assert.equal(splitConnectorBody(module, { syncIntervalSeconds: 60 }).syncIntervalSeconds, 60)
})

test('an absent label and interval stay absent rather than becoming defaults', () => {
  const body = splitConnectorBody(module, { baseUrl: 'https://gitlab.example' })

  assert.equal('label' in body, false)
  assert.equal('syncIntervalSeconds' in body, false)
})

// A connector stored without its required credential would spend every interval failing for a
// reason nothing recorded yet.
test('a create missing a required credential is refused', () => {
  assert.throws(
    () => requireSecrets(module, {}),
    (error: unknown) =>
      error instanceof ApiError && error.status === 400 && /Access token/.test(error.message),
  )

  assert.doesNotThrow(() => requireSecrets(module, { token: 'glpat-secret' }))
})

const record: ConnectorRecord = {
  id: 7,
  type: 'fake',
  label: 'Work',
  enabled: true,
  position: 1000,
  syncIntervalSeconds: 900,
  config: { baseUrl: 'https://gitlab.example', groups: ['a'], includeSubgroups: true },
  secrets: { token: { set: true, updatedAt: '2026-01-01 00:00:00' } },
  sync: { lastOkAt: null, lastError: null, nextRunAt: null, running: false },
} as unknown as ConnectorRecord

// The editor shows whether a secret is set, never its value.
test('the admin row carries whether a credential is set and never the credential', () => {
  const row = toAdminRow(record, module)

  assert.equal(row.token, true)
  assert.equal(JSON.stringify(row).includes('glpat'), false)
  assert.equal(row.baseUrl, 'https://gitlab.example')
  assert.deepEqual(row.groups, ['a'])
  assert.equal(row.label, 'Work')
  assert.equal(row.enabled, true)
})

test('a config field the row has never held reads as null rather than missing', () => {
  const bare = { ...record, config: {}, secrets: {} } as unknown as ConnectorRecord
  const row = toAdminRow(bare, module)

  assert.equal(row.baseUrl, null)
  assert.equal(row.groups, null)
  assert.equal(row.token, false)
})
