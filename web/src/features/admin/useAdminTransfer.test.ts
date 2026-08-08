import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_EXPORT_URL, ADMIN_IMPORT_URL } from '@/config/api'
import { resetPortalConfig } from '@/composables/usePortalConfig'
import { useAdminTransfer } from '@/features/admin/useAdminTransfer'
import { withSetup } from '@/testing/withSetup'

const EXPORT = { version: 2, cards: [], sites: [] }

const CONFIG = {
  brand: { title: 'diele', subtitle: 'start page', accentLight: '#16a34a', accentDark: '#22c55e' },
  cards: [],
  sites: [],
  engines: [],
  commands: [],
  localhost: [],
  settings: {},
}

/**
 * Builds the change event a file input raises, carrying the chosen file.
 * @param {string | undefined} contents - What the file holds, or undefined for no file at all
 * @returns {Event} - The event, with an input as its target
 */
function chooseFile(contents: string | undefined): Event {
  const input = document.createElement('input')
  input.type = 'file'

  const files =
    contents === undefined
      ? []
      : [new File([contents], 'diele-settings.json', { type: 'application/json' })]

  Object.defineProperty(input, 'files', { configurable: true, value: files })

  return { target: input } as unknown as Event
}

/**
 * Finds the call a transfer made, ignoring the config read the composable does on the way in.
 * @param {ReturnType<typeof vi.fn>} fetchMock - The stubbed fetch
 * @param {string} url - Endpoint to look for
 * @returns {RequestInit | undefined} - How that endpoint was called
 */
function callTo(fetchMock: ReturnType<typeof vi.fn>, url: string): RequestInit | undefined {
  const call = fetchMock.mock.calls.find(([input]) => String(input) === url)

  return call?.[1] as RequestInit | undefined
}

/**
 * Mounts the composable inside a component, so its lifecycle runs.
 * @returns {ReturnType<typeof useAdminTransfer>} - The transfer source
 */
function transfer(onImported = vi.fn()) {
  return withSetup(() => useAdminTransfer(onImported)).result
}

beforeEach(() => {
  resetPortalConfig()
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() }))
})

afterEach(() => {
  resetPortalConfig()
  vi.unstubAllGlobals()
})

describe('exporting', () => {
  // A folder of these sorts by date and says which deployment each one came from.
  it('names the file after the portal and the day it was taken', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              String(input).includes('/api/config')
                ? { ...CONFIG, brand: { ...CONFIG.brand, title: 'Ops Portal' } }
                : EXPORT,
            ),
          ),
        ),
      ),
    )
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const source = transfer()
    await vi.waitFor(() => expect(source).toBeDefined())
    await source.exportSettings()

    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toMatch(/^ops-portal-settings-\d{4}-\d{2}-\d{2}\.json$/)
    expect(source.message.value).toBe('exported')
    expect(source.failed.value).toBe(false)
  })

  it('reports a refused export rather than downloading nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 403 }))),
    )

    const source = transfer()
    await source.exportSettings()

    expect(source.failed.value).toBe(true)
    expect(source.message.value).toContain('403')
    expect(source.busy.value).toBe(false)
  })
})

describe('importing', () => {
  // It replaces the configuration rather than merging into it, so the one thing that must never
  // regress is that nothing is sent before someone agreed to that.
  it('sends nothing when the confirmation is declined', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}')))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    await transfer().importSettings(chooseFile(JSON.stringify(EXPORT)))

    expect(callTo(fetchMock, ADMIN_IMPORT_URL)).toBeUndefined()
  })

  it('asks before replacing anything', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ written: {} })))),
    )
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    await transfer().importSettings(chooseFile(JSON.stringify(EXPORT)))

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('replaces every'))
  })

  it('does nothing at all when no file was chosen', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}')))
    vi.stubGlobal('fetch', fetchMock)
    const confirm = vi.spyOn(window, 'confirm')

    await transfer().importSettings(chooseFile(undefined))

    expect(confirm).not.toHaveBeenCalled()
    expect(callTo(fetchMock, ADMIN_IMPORT_URL)).toBeUndefined()
  })

  it('posts the file as it stands and reports what was written', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ written: { cards: 3, icons: 1 } }))),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onImported = vi.fn()

    const source = transfer(onImported)
    await source.importSettings(chooseFile(JSON.stringify(EXPORT)))

    const init = callTo(fetchMock, ADMIN_IMPORT_URL)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(EXPORT)
    expect(source.message.value).toBe('imported 3 cards, 1 icons')
    expect(onImported).toHaveBeenCalled()
  })

  // The panel has to go back to the API afterwards, since everything it was showing was just
  // replaced by whatever the file carried.
  it('does not report a refused import as done', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'invalid request' }), { status: 400 }),
        ),
      ),
    )
    const onImported = vi.fn()

    const source = transfer(onImported)
    await source.importSettings(chooseFile('{"version":99}'))

    expect(source.failed.value).toBe(true)
    expect(source.message.value).toBe('invalid request')
    expect(onImported).not.toHaveBeenCalled()
    expect(source.busy.value).toBe(false)
  })

  it('clears the input so the same file can be chosen again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ written: {} })))),
    )

    const event = chooseFile(JSON.stringify(EXPORT))
    await transfer().importSettings(event)

    expect((event.target as HTMLInputElement).value).toBe('')
  })

  it('reports an unreachable API rather than leaving the panel busy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    )

    const source = transfer()
    await source.importSettings(chooseFile(JSON.stringify(EXPORT)))

    expect(source.failed.value).toBe(true)
    expect(source.message.value).toBe('offline')
    expect(source.busy.value).toBe(false)
  })
})

// One panel's last action is nobody else's business, and a message that outlived the panel
// would greet the next one with the previous session's result.
it('keeps its state to the panel that asked for it', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(null, { status: 403 }))),
  )

  const first = transfer()
  await first.exportSettings()
  expect(first.failed.value).toBe(true)

  const second = transfer()

  expect(second.failed.value).toBe(false)
  expect(second.message.value).toBeUndefined()
})

it('reads the export from the endpoint the panel is meant to use', async () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(EXPORT))))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

  await transfer().exportSettings()

  expect(callTo(fetchMock, ADMIN_EXPORT_URL)).toBeDefined()
})
