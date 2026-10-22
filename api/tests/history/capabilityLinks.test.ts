import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isCapabilityLink } from '#history/capabilityLinks.js'

// A link that is itself the key, short or tidy as its id may look: page-id shapes are no excuse.
test('an opaque id behind a capability keyword is refused', () => {
  for (const path of [
    '/reset/a1b2c3d4e5',
    '/invite/AbCdEfGhIjK',
    '/s/AbCdEf1234',
    '/r/homelab/s/Xk9fQ2mZ7p',
    '/share/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    '/shared/0123456789abcdef0123456789abcdef',
    '/verify/email/k3j4h5g6f7',
    '/auth/magic/xkqzplmwbt',
    '/api/webhooks/123456789012/abcdefghij',
    '/unsubscribe/user42abcdef',
    '/reset-password/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    '/invitation/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    '/invitations/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    '/join/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    '/login/magic-link/0123456789abcdef0123456789abcdef',
    '/users/password_reset/AbCdEf1234',
    '/team/accept.invite/k3j4h5g6f7',
    '/claim/AbCdEfGhIjK',
    '/approve/1234567890ab',
  ]) {
    assert.equal(isCapabilityLink(path), true, path)
  }
})

test('words and short routes behind a keyword are kept, and ids without one', () => {
  for (const path of [
    '/share/team-roadmap',
    '/auth/admin/master/console',
    '/s/settings',
    '/download',
    '/d/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/node-exporter-full',
    '/acme/0123456789abcdef0123456789abcdef',
    '/browse/ABC-123',
    '/docs/login-flow',
    '/blog/how-to-reset-password',
    '/settings/password',
    '/join',
    '/signin',
    '/docs/login-flow/kubernetes-integration',
  ]) {
    assert.equal(isCapabilityLink(path), false, path)
  }
})

test('a keyword written in capitals or percent-encoded is still a keyword', () => {
  assert.equal(isCapabilityLink('/RESET/a1b2c3d4e5'), true)
  assert.equal(isCapabilityLink('/%72eset/a1b2c3d4e5'), true)
  assert.equal(isCapabilityLink('/%2572eset/a1b2c3d4e5'), true)
})

// An encoded slash is a slash to whatever routes the request, so it is one here too.
test('an encoded slash inside a segment is a boundary', () => {
  assert.equal(isCapabilityLink('/reset%2Fabc123def456'), true)
  assert.equal(isCapabilityLink('/reset%2fabc123def456'), true)
  assert.equal(isCapabilityLink('/reset%252Fabc123def456'), true)
  assert.equal(isCapabilityLink('/docs%2Freset'), false)
})

// A slug, a camelCase file name and a short route are never an id, wherever they stand.
test('ordinary pages that merely mention a keyword are kept', () => {
  for (const path of [
    '/acme/auth-service/blob/main/src/oauth2Client.ts',
    '/acme/auth-service/tree/main/docs/kubernetesIntegration.md',
    '/reset/MQ/set-password',
    '/share/Team Roadmap 2024',
    '/auth/realms/master/account',
    '/auth/oauth2-setup-guide',
    '/what-s-new/release-2024',
    '/share/quarterly_report.2024',
    '/s/gettingStartedGuide',
  ]) {
    assert.equal(isCapabilityLink(path), false, path)
  }
})

test('a one-letter keyword counts as a whole segment only', () => {
  assert.equal(isCapabilityLink('/s/AbCdEf1234'), true)
  assert.equal(isCapabilityLink('/what-s/AbCdEf1234'), false)
})

// A short id between the keyword and the token is skipped, not taken for the end of the link.
test('an opaque id anywhere after the keyword is refused, a short one in between skipped', () => {
  for (const path of [
    '/reset/MQ/c5v8pt-0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b/',
    '/email/verify/42/9f86d081884c7d659a2feaa0c55ad015',
    '/invite/team/42/deadbeef-cafe-babe-face-feedfacecafe',
    '/acme/auth-service/commit/3f9a1c7e2b4d6f8a0c1e3b5d7f9a2c4e6b8d0f1a',
  ]) {
    assert.equal(isCapabilityLink(path), true, path)
  }
})
