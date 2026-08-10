import { describe, expect, it } from 'vitest'
import { apiFieldMessage, apiMessage, readPayload } from '@/helpers/apiError'

/**
 * Builds a response carrying a body, the way fetch hands one back.
 * @param {string} body - Raw body text
 * @param {string} contentType - Content type header
 * @returns {Response} - The response
 */
function responseOf(body: string, contentType = 'application/json'): Response {
  return new Response(body, { status: 400, headers: { 'content-type': contentType } })
}

describe('readPayload', () => {
  it('parses a json body', async () => {
    expect(await readPayload(responseOf('{"error":"nope"}'))).toEqual({ error: 'nope' })
  })

  // A failure answered with html or with nothing at all still has to produce something a
  // caller can read a message out of.
  it('reads a body that is not json as empty', async () => {
    expect(await readPayload(responseOf('<h1>502 Bad Gateway</h1>', 'text/html'))).toEqual({})
    expect(await readPayload(responseOf(''))).toEqual({})
  })

  it('reads a json body that is not an object as empty', async () => {
    expect(await readPayload(responseOf('"a string"'))).toEqual({})
    expect(await readPayload(responseOf('null'))).toEqual({})
    expect(await readPayload(responseOf('42'))).toEqual({})
  })
})

describe('apiMessage', () => {
  // A validation failure names what actually went wrong where the summary only says that
  // something did.
  it('prefers the first detail over the summary', () => {
    const message = apiMessage(
      { error: 'invalid request', details: [{ message: 'must be an absolute http(s) url' }] },
      'fallback',
    )

    expect(message).toBe('must be an absolute http(s) url')
  })

  it('falls back to the summary, then to the caller fallback', () => {
    expect(apiMessage({ error: 'not found' }, 'fallback')).toBe('not found')
    expect(apiMessage({}, 'fallback')).toBe('fallback')
    expect(apiMessage({ details: [] }, 'fallback')).toBe('fallback')
    expect(apiMessage({ details: [{}] }, 'fallback')).toBe('fallback')
  })
})

describe('apiFieldMessage', () => {
  it('prefixes the message with the field that failed', () => {
    const message = apiFieldMessage(
      { details: [{ path: ['url'], message: 'must be an absolute http(s) url' }] },
      'fallback',
    )

    expect(message).toBe('url: must be an absolute http(s) url')
  })

  it('joins a nested path', () => {
    const message = apiFieldMessage(
      { details: [{ path: ['cards', 0, 'url'], message: 'bad' }] },
      'f',
    )

    expect(message).toBe('cards.0.url: bad')
  })

  it('leaves the message bare when the failure names no field', () => {
    expect(apiFieldMessage({ details: [{ message: 'bad' }] }, 'f')).toBe('bad')
    expect(apiFieldMessage({ details: [{ path: [], message: 'bad' }] }, 'f')).toBe('bad')
  })

  it('falls back to the summary and then the caller fallback', () => {
    expect(apiFieldMessage({ error: 'not found' }, 'fallback')).toBe('not found')
    expect(apiFieldMessage({}, 'fallback')).toBe('fallback')
  })
})
