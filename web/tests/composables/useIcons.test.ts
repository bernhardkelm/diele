import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetIcons, useIcons } from '@/composables/useIcons'
import { resetPortalConfig } from '@/composables/usePortalConfig'

const ICON = { id: 3, name: 'square', svg: '<svg viewBox="0 0 8 8"><path d="M0 0h8v8H0z"/></svg>' }

/**
 * Builds the file a picker hands over.
 * @param {string} name - File name, whose extension the upload strips
 * @param {string} contents - Raw markup
 * @returns {File} - The chosen file
 */
function svgFile(name: string, contents = '<svg/>'): File {
  return new File([contents], name, { type: 'image/svg+xml' })
}

beforeEach(() => {
  // Held at module scope, so an upload in one test is still in the library in the next.
  resetIcons()
  resetPortalConfig()
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  resetIcons()
  resetPortalConfig()
  vi.unstubAllGlobals()
})

describe('loading the library', () => {
  it('reads the uploaded icons', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ icons: [ICON] }))),
    )

    const library = useIcons()
    await library.load()

    expect(library.icons.value).toEqual([ICON])
  })

  // Every card's icon field draws from the same set, and a second field asking must not mean
  // a second request.
  it('loads once however many fields ask', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ icons: [ICON] })))
    vi.stubGlobal('fetch', fetchMock)

    await useIcons().load()
    await useIcons().load()
    await useIcons().load()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // An unreachable library only costs the picker, not the rest of the form.
  it('leaves the picker empty rather than failing when it cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const library = useIcons()
    await expect(library.load()).resolves.toBeUndefined()
  })

  it('leaves it empty when the request is refused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })))

    await expect(useIcons().load()).resolves.toBeUndefined()
  })
})

describe('uploading an icon', () => {
  it('sends the markup under the file name, without its extension', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ icon: ICON })))
    vi.stubGlobal('fetch', fetchMock)

    const library = useIcons()
    const stored = await library.upload(svgFile('Grafana.SVG', '<svg/>'))

    expect(stored).toEqual(ICON)

    const body = JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body))
    expect(body).toEqual({ name: 'Grafana', svg: '<svg/>' })
  })

  it('adds what was stored to the library', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ icon: ICON }))))

    const library = useIcons()
    await library.upload(svgFile('square.svg'))

    expect(library.icons.value).toContainEqual(ICON)
  })

  // The sanitiser refuses anything it cannot make safe, and its reason is the only thing that
  // says what is wrong with the file.
  it('surfaces why the server refused it', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'svg needs a viewBox' }), { status: 400 }),
        ),
    )

    const library = useIcons()
    const stored = await library.upload(svgFile('bad.svg'))

    expect(stored).toBeUndefined()
    expect(library.error.value).toBe('svg needs a viewBox')
  })

  it('reports a failure with no message of its own', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))

    const library = useIcons()
    await library.upload(svgFile('bad.svg'))

    expect(library.error.value).toBe('upload failed')
  })

  it('clears the busy flag whether it worked or not', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const library = useIcons()
    await library.upload(svgFile('x.svg'))

    expect(library.busy.value).toBe(false)
    expect(library.error.value).toBe('offline')
  })
})

describe('deleting an icon', () => {
  /**
   * Answers the delete, and the configuration reread that follows it.
   * @param {object} answer - Status and body the delete responds with
   * @returns {ReturnType<typeof vi.fn>} - The stubbed fetch
   */
  function stubDelete(
    answer: { status: number; body: unknown } = { status: 200, body: { ok: true } },
  ) {
    return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }))
      }

      return Promise.resolve(new Response(JSON.stringify({ icons: [ICON] })))
    })
  }

  it('addresses the icon by id and drops it from the library', async () => {
    const fetchMock = stubDelete()
    vi.stubGlobal('fetch', fetchMock)

    const library = useIcons()
    await library.load()

    await expect(library.remove(ICON.id)).resolves.toBe(true)

    expect(library.icons.value).toEqual([])
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).endsWith('/icons/3') && init?.method === 'DELETE',
      ),
    ).toBe(true)
  })

  // The card referencing it is not deleted with it, the reference is cleared, so every page
  // painting that card is showing a logo the database no longer holds.
  it('reads the configuration again, so the cards lose the icon too', async () => {
    const fetchMock = stubDelete()
    vi.stubGlobal('fetch', fetchMock)

    await useIcons().remove(ICON.id)

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/config'))).toBe(true)
  })

  it('keeps the icon and says why when the delete was refused', async () => {
    vi.stubGlobal('fetch', stubDelete({ status: 404, body: { error: 'icon not found' } }))

    const library = useIcons()
    await library.load()

    await expect(library.remove(ICON.id)).resolves.toBe(false)

    expect(library.icons.value).toEqual([ICON])
    expect(library.error.value).toBe('icon not found')
  })

  it('clears the busy flag whether it worked or not', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const library = useIcons()
    await library.remove(ICON.id)

    expect(library.busy.value).toBe(false)
    expect(library.error.value).toBe('offline')
  })
})

describe('previewing an icon', () => {
  it('finds the markup of a stored icon', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ icons: [ICON] }))),
    )

    const library = useIcons()
    await library.load()

    expect(library.svgFor(ICON.id)).toBe(ICON.svg)
  })

  it('answers with nothing for a card that has no icon, or one that is gone', () => {
    const library = useIcons()

    expect(library.svgFor(null)).toBe('')
    expect(library.svgFor(undefined)).toBe('')
    expect(library.svgFor(4242)).toBe('')
  })
})
