import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FILTER_FILES, loadScripts } from './load.js'

const scripts = loadScripts(FILTER_FILES)

const FILTER = {
  instanceOrigins: ['https://portal.example.com', 'https://work.example.org:8443'],
  searchPatterns: [
    scripts.compileSearchTemplate('https://search.example.com/find?term={query}'),
    scripts.compileSearchTemplate('https://wiki.example/w/{query}'),
    scripts.compileSearchTemplate('https://www.code.example/{query}'),
  ],
  excludedDomains: ['bank.example', 'private.test'],
}

/**
 * Runs the filter on one url with the shared settings.
 * @param {string} raw - Url as loaded
 * @returns {string | undefined} - What would be buffered
 */
function accept(raw) {
  return scripts.acceptHistoryVisit(raw, FILTER)
}

test('the pages people revisit are kept, stripped to origin and path', () => {
  const cases = {
    'https://grafana.example.com/d/nErXDvCkzz/kubernetes-overview-dashboard?orgId=1&from=now-6h':
      'https://grafana.example.com/d/nErXDvCkzz/kubernetes-overview-dashboard',
    'https://grafana.example.com/d/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/node-exporter-full':
      'https://grafana.example.com/d/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/node-exporter-full',
    'https://github.com/bernhardkelm/diele/pull/27/files#diff-4f2c':
      'https://github.com/bernhardkelm/diele/pull/27/files',
    'https://acme.atlassian.net/browse/ABC-123?focusedCommentId=1':
      'https://acme.atlassian.net/browse/ABC-123',
    'https://acme.atlassian.net/wiki/spaces/ENG/pages/123456789/Kubernetes+Overview+Dashboard':
      'https://acme.atlassian.net/wiki/spaces/ENG/pages/123456789/Kubernetes+Overview+Dashboard',
    'https://www.notion.so/acme/Quarterly-Planning-Notes-0123456789abcdef0123456789abcdef':
      'https://www.notion.so/acme/Quarterly-Planning-Notes-0123456789abcdef0123456789abcdef',
    'https://user:secret@docs.example.com/guide/': 'https://docs.example.com/guide',
    'https://shop.example/cart;jsessionid=0123456789ABCDEF': 'https://shop.example/cart',
    'https://Example.COM./': 'https://example.com/',
    'https://github.com/search': 'https://github.com/search',
    'https://portal.example.com:8443/': 'https://portal.example.com:8443/',
    'https://github.com/acme/auth-service/blob/main/src/oauth2Client.ts':
      'https://github.com/acme/auth-service/blob/main/src/oauth2Client.ts',
    'https://docs.example.com/auth/oauth2-setup-guide':
      'https://docs.example.com/auth/oauth2-setup-guide',
    'https://blog.example.com/what-s-new/release-2024':
      'https://blog.example.com/what-s-new/release-2024',
    'https://app.example/reset/MQ/set-password': 'https://app.example/reset/MQ/set-password',
    'https://app.example/docs/login-flow/kubernetes-integration':
      'https://app.example/docs/login-flow/kubernetes-integration',
    'https://shop.example/cart%3Bjsessionid%3D0123456789ABCDEF/items':
      'https://shop.example/cart/items',
    'https://shop.example/a%20b;v=1/c': 'https://shop.example/a%20b/c',
    'https://docs.example.com//guide//intro/': 'https://docs.example.com/guide/intro',
  }

  for (const [raw, stored] of Object.entries(cases)) {
    assert.equal(accept(raw), stored, raw)
  }
})

test('links that carry a key are dropped', () => {
  for (const raw of [
    'https://app.example.com/reset/Xk9fQ2mZ7pL4wR8tY1vB6nC3hJ5sD0gA',
    'https://app.example.com/users/password_reset/AbCdEf1234',
    'https://app.example/invite/a1b2c3d4e5',
    'https://app.example/reset%2Fabc123def456',
    'https://app.example/%2572eset/a1b2c3d4e5',
    'https://app.example/s/8f14e45fceea167a5a36dedd4bea2543c7f3a9b1',
    'https://app.example/login/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    'https://app.example/reset;token=Xk9fQ2mZ7pL4wR8tY1vB6nC3hJ5sD0gA/Xk9fQ2mZ7pL4wR8tY1vB6nC3hJ5sD0gA',
    'https://app.example/reset/MQ/c5v8pt-0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b/',
    'https://app.example/email/verify/42/9f86d081884c7d659a2feaa0c55ad015',
    'https://docs.example.com/login/troubleshooting-guide/a1b2c3d4e5f6',
    'https://app.example/share/abc/def/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    'https://app.example/invite/x/3f9a1c7e2b4d6f8a0c1e3b5d7f9a2c4e6b8d0f1a',
  ]) {
    assert.equal(accept(raw), undefined, raw)
  }
})

// The code and the state ride in the query and the token in the fragment; neither is kept, and
// the callback path itself is an ordinary page once they are gone.
test('an OAuth callback and a fragment token lose what they carry', () => {
  assert.equal(
    accept('https://app.example.com/oauth/callback?code=SplxlOBeZQQYbYS6WxSbIA&state=xyz123'),
    'https://app.example.com/oauth/callback',
  )
  assert.equal(
    accept('https://app.example.com/#access_token=eyJhbGciOiJIUzI1NiJ9.e30.abc&token_type=bearer'),
    'https://app.example.com/',
  )
})

test('a search results page is dropped, judged before its query is stripped', () => {
  for (const raw of [
    'https://www.google.com/search?q=secret+diagnosis',
    'https://www.google.de/maps/place/Somewhere',
    'https://duckduckgo.com/?q=private',
    'https://www.youtube.com/results?search_query=something',
    'https://github.com/search?q=diele',
    'https://search.example.com/find?term=x',
    'https://wiki.example/w/Some_Article',
    'https://code.example/anything',
    'https://www.code.example/anything/',
  ]) {
    assert.equal(accept(raw), undefined, raw)
  }
})

// A term right after the root names the whole site; only the one-segment page it opens is a search
test('a root template drops one segment on its own host and nothing else', () => {
  for (const raw of [
    'https://code.example/',
    'https://code.example/acme/repo',
    'https://gist.code.example/anything',
    'https://code.example:8443/anything',
  ]) {
    assert.notEqual(accept(raw), undefined, raw)
  }
})

test('every loopback spelling is dropped', () => {
  for (const raw of [
    'http://localhost:5173/',
    'http://localhost./',
    'http://app.localhost/',
    'http://127.0.0.1:3000/x',
    'http://127.1.2.3/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://0.0.0.0:8080/',
    'http://[::1]/',
    'http://[::]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:0:7f00:1]/',
    'http://[64:ff9b::7f00:1]/',
  ]) {
    assert.equal(accept(raw), undefined, raw)
  }
})

test('link-local and metadata hosts are dropped, the way the server drops them', () => {
  for (const raw of [
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://169.254.1.1/',
    'http://100.100.100.200/latest/meta-data/',
    'http://[fe80::1]/',
    'http://[febf::1]/',
    'http://[fd00:ec2::254]/latest/meta-data/',
    'http://[::ffff:169.254.169.254]/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://metadata.google.internal./computeMetadata/v1/',
    'http://metadata/computeMetadata/v1/',
  ]) {
    assert.equal(accept(raw), undefined, raw)
  }

  assert.equal(accept('http://100.100.100.201/'), 'http://100.100.100.201/')
})

test('documentation, multicast, broadcast and other special-purpose hosts are dropped', () => {
  for (const raw of [
    'http://192.0.2.1/',
    'http://192.0.0.8/',
    'http://198.51.100.7/',
    'http://203.0.113.9/',
    'http://192.88.99.1/',
    'http://224.0.0.1/',
    'http://239.255.255.250/',
    'http://240.0.0.1/',
    'http://255.255.255.255/',
    'http://198.18.0.1/',
    'http://198.19.255.255/',
    'http://[2001:db8::1]/',
    'http://[3fff::1]/',
    'http://[2001::1]/',
    'http://[fec0::1]/',
    'http://[ff02::1]/',
    'http://[2002::1]/',
    'http://[100::1]/',
    'http://[::ffff:192.0.2.1]/',
  ]) {
    assert.equal(accept(raw), undefined, raw)
  }
})

test('a private address is kept and left to the server, and so is a public one', () => {
  for (const raw of [
    'http://192.168.1.10/admin',
    'http://10.0.0.1/',
    'http://172.31.255.1/',
    'http://100.64.0.1/',
    'http://[fd00::1]/',
    'http://[fc00::1]/',
    'http://8.8.8.8/',
    'http://198.20.0.1/',
    'http://[2606:4700:4700::1111]/',
    'http://[2001:200::1]/',
  ]) {
    assert.equal(accept(raw), raw, raw)
  }
})

test('an excluded domain is dropped with its subdomains, a trailing dot changing nothing', () => {
  for (const raw of [
    'https://bank.example/accounts',
    'https://online.bank.example/accounts',
    'https://bank.example./accounts',
    'https://private.test/',
  ]) {
    assert.equal(accept(raw), undefined, raw)
  }

  assert.equal(accept('https://notbank.example/'), 'https://notbank.example/')
})

test('diele itself, not http(s), and an over-long url are dropped', () => {
  for (const raw of [
    'https://portal.example.com/#/admin',
    'https://portal.example.com./settings',
    'https://work.example.org:8443/',
    'mailto:someone@example.com',
    'chrome://settings/',
    'file:///Users/someone/notes.txt',
    `https://example.com/${'a'.repeat(2100)}`,
  ]) {
    assert.equal(accept(raw), undefined, raw)
  }
})

// A search page titles itself with the term and a single-page app with its route, both of which
// the stripped url left out
test('a title carrying a parameter value or a fragment piece is dropped', () => {
  for (const [raw, title] of [
    ['https://search.example.org/?q=embarrassing+thing', 'Embarrassing Thing - Search'],
    ['https://search.example.org/?q=embarrassing%20thing', 'embarrassing thing'],
    ['https://app.example.com/#token=abcdefgh12345', 'abcdefgh12345'],
    ['https://mail.example.com/#inbox/FMfcgzQbfLVq', 'Inbox FMfcgzQbfLVq - Mail'],
    ['https://app.example.com/#/search?term=Diagnosis', 'Results for diagnosis'],
  ]) {
    assert.equal(scripts.cleanHistoryTitle(raw, title), undefined, raw)
  }
})

test('a value counts only as a whole word in the title', () => {
  for (const [raw, title] of [
    ['https://docs.example.com/setup?tab=all', 'Install'],
    ['https://shop.example.com/?s=all', 'Small business guide'],
    ['https://docs.example.com/?lang=eng', 'English docs'],
    ['https://app.example.com/#/ing', 'Pricing'],
    ['https://docs.example.com/?v=123', 'Release 1234'],
  ]) {
    assert.equal(scripts.cleanHistoryTitle(raw, title), title, `${raw} ${title}`)
  }

  for (const [raw, title] of [
    ['https://docs.example.com/setup?tab=all', 'Show all - Docs'],
    ['https://shop.example.com/?s=all', 'all'],
    ['https://docs.example.com/?lang=eng', '(eng) docs'],
    ['https://docs.example.com/?q=k%C3%B6ln', 'Wetter Köln'],
    ['https://docs.example.com/?v=123', 'Release 123'],
  ]) {
    assert.equal(scripts.cleanHistoryTitle(raw, title), undefined, `${raw} ${title}`)
  }
})

test('the host is looked for without www. and its trailing dot, a single label not at all', () => {
  assert.equal(
    scripts.cleanHistoryTitle('https://example.com/', 'Welcome to example.com'),
    undefined,
  )
  assert.equal(
    scripts.cleanHistoryTitle('https://www.example.com./', 'example.com home'),
    undefined,
  )
  assert.equal(scripts.cleanHistoryTitle('http://nas/', 'nas admin'), 'nas admin')
  assert.equal(scripts.cleanHistoryTitle('https://a.example/', 'HTTPS://a.example'), undefined)
})

test('a fragment piece is decoded once, the way the server decodes it', () => {
  assert.equal(
    scripts.cleanHistoryTitle('https://a.example/#q=caf%C3%A9+bar', 'Café bar'),
    undefined,
  )
  assert.equal(scripts.cleanHistoryTitle('https://a.example/#q=caf%25C3%25A9', 'café'), 'café')
})

test('a short or unrelated value keeps the title', () => {
  assert.equal(
    scripts.cleanHistoryTitle('https://docs.example.com/guide?tab=2&ref=newsletter', 'Guide 2'),
    'Guide 2',
  )
  assert.equal(
    scripts.cleanHistoryTitle('https://app.example.com/#ab', 'About abacus'),
    'About abacus',
  )
})

test('control characters become spaces and format characters go, as on the server', () => {
  assert.equal(
    scripts.cleanHistoryTitle('https://a.example/', 'Invoice\u202Efdp.exe\u200B\nPaid\u0007now'),
    'Invoicefdp.exe Paid now',
  )
  assert.equal(scripts.cleanHistoryTitle('https://a.example/', '\u202E\u200B'), undefined)
})

test('a title that repeats the address is dropped, a real one kept and cut', () => {
  const raw = 'https://app.example.com/oauth/callback?code=SplxlOBeZQQYbYS6WxSbIA&state=xyz123'

  assert.equal(
    scripts.cleanHistoryTitle(raw, 'app.example.com/oauth/callback?code=Splx'),
    undefined,
  )
  assert.equal(
    scripts.cleanHistoryTitle(raw, 'Signed in: code=SplxlOBeZQQYbYS6WxSbIA&state=xyz123'),
    undefined,
  )
  assert.equal(scripts.cleanHistoryTitle(raw, 'https://app.example.com/'), undefined)
  assert.equal(scripts.cleanHistoryTitle(raw, '  Welcome   back  '), 'Welcome back')
  assert.equal(scripts.cleanHistoryTitle(raw, 'HTTP status codes'), 'HTTP status codes')
  assert.equal(scripts.cleanHistoryTitle(raw, undefined), undefined)
  assert.equal(scripts.cleanHistoryTitle('https://a.example/', 'x'.repeat(400)).length, 300)
})
