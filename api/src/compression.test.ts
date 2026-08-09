import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { after, before, test } from 'node:test'
import { startApi, type TestApi } from '#testing/harness.js'

interface RawResponse {
  readonly status: number
  readonly encoding: string | undefined
  /** Bytes actually transferred, before any decoding */
  readonly bytes: number
}

let api: TestApi
let cookie: string

/**
 * Fetches a path without letting the client decode the body. Not through `fetch`, which negotiates
 * an encoding of its own and decompresses transparently, leaving nothing to assert on.
 * @param {string} path - Path to request
 * @param {string} acceptEncoding - Value to send as `Accept-Encoding`
 * @returns {Promise<RawResponse>} - Status, the encoding chosen, and the transferred size
 */
function raw(path: string, acceptEncoding: string): Promise<RawResponse> {
  const { hostname, port } = new URL(api.url)

  return new Promise<RawResponse>((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: hostname,
        port,
        path,
        method: 'GET',
        headers: { 'accept-encoding': acceptEncoding, cookie },
      },
      (incoming) => {
        let bytes = 0

        incoming.on('data', (chunk: Buffer) => {
          bytes += chunk.length
        })

        incoming.once('end', () => {
          const encoding = incoming.headers['content-encoding']

          resolve({
            status: incoming.statusCode ?? 0,
            encoding: Array.isArray(encoding) ? encoding.join(', ') : encoding,
            bytes,
          })
        })
      },
    )

    outgoing.once('error', reject)
    outgoing.end()
  })
}

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev', DIELE_SEED_STOCK_CONFIG: 'true' })

  const login = await api.request('/api/auth/login')
  cookie = login.headers
    .getSetCookie()
    .map((value) => {
      const [pair = ''] = value.split(';')
      return pair
    })
    .join('; ')

  // The stock configuration alone lands just under the size below which compressing a response
  // costs more than it saves, and the middleware rightly leaves it alone. A portal with a screen
  // of cards on it is past that, which is the state worth measuring.
  for (let index = 0; index < 30; index += 1) {
    await api.post('/api/admin/links/card', {
      label: `Compression fixture card number ${index}`,
      url: `https://fixture-${index}.example.test/dashboard`,
    })
  }
})

after(async () => {
  await api.close()
})

test('brotli is what a browser offering both is served', async () => {
  const response = await raw('/api/config', 'br, gzip, deflate')

  assert.equal(response.status, 200)
  assert.equal(response.encoding, 'br')
})

test('a client without brotli still gets gzip rather than nothing', async () => {
  const response = await raw('/api/config', 'gzip, deflate')

  assert.equal(response.status, 200)
  assert.equal(response.encoding, 'gzip')
})

// The measurement rather than the header: a `Content-Encoding` that named an encoding nothing had
// applied would pass every assertion above and hand the browser a body it cannot read.
test('the compressed body is materially smaller than the original', async () => {
  const identity = await raw('/api/config', 'identity')
  const compressed = await raw('/api/config', 'br')

  assert.equal(identity.encoding, undefined)
  assert.ok(
    identity.bytes > 1024,
    `payload was ${identity.bytes} bytes, too small to be compressed`,
  )
  assert.ok(
    compressed.bytes < identity.bytes / 2,
    `brotli returned ${compressed.bytes} bytes against ${identity.bytes} uncompressed`,
  )
})
