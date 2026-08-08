import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import LoginGate from '@/views/LoginGate.vue'
import CredentialForm from '@/components/CredentialForm.vue'
import { resetPortalConfig } from '@/composables/usePortalConfig'
import { resetConnectorEntries } from '@/composables/useConnectorEntries'
import { resetSession, useSession } from '@/composables/useSession'

const BRAND = {
  title: 'diele',
  subtitle: 'start page',
  accentLight: '#16a34a',
  accentDark: '#22c55e',
}

interface ApiState {
  mode: 'local' | 'oidc' | 'dev'
  setupRequired?: boolean
  /** What the credential post answers with, so a test can make it fail */
  credentials?: { status: number; body: unknown }
  /** Whether /me reports a session afterwards, which is how a dropped cookie shows up */
  signedIn?: boolean
}

const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = []

// Two tests below swap the whole object in, because `assign` is not configurable on the real
// one. Without putting it back, every later test writes its hash to a plain object that does
// none of a real Location's normalising.
const realLocation = window.location

/**
 * Answers the endpoints the gate reads, in whatever state the test asked for.
 * @param {ApiState} state - How this deployment should behave
 * @returns {ReturnType<typeof vi.fn>} - The stubbed fetch
 */
function stubApi(state: ApiState) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })

    if (url.includes('/api/auth/providers')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            brand: BRAND,
            mode: state.mode,
            setupRequired: state.setupRequired === true,
            providers: state.mode === 'oidc' ? [{ id: 'oidc', name: 'Single Sign-On' }] : [],
          }),
        ),
      )
    }

    if (url.includes('/api/auth/me')) {
      return state.signedIn === false
        ? Promise.resolve(new Response(null, { status: 401 }))
        : Promise.resolve(
            new Response(
              JSON.stringify({ id: 1, name: 'Ada', email: null, picture: null, canAdmin: true }),
            ),
          )
    }

    if (url.includes('/api/auth/login') || url.includes('/api/auth/setup')) {
      const answer = state.credentials ?? { status: 200, body: { ok: true } }
      return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }))
    }

    return Promise.resolve(new Response(JSON.stringify({}), { status: 401 }))
  })
}

/**
 * Mounts the gate and waits for the mode to arrive.
 * @param {ApiState} state - How this deployment should behave
 * @returns {Promise<VueWrapper>} - The mounted gate
 */
async function open(state: ApiState): Promise<VueWrapper> {
  vi.stubGlobal('fetch', stubApi(state))
  const wrapper = mount(LoginGate, { attachTo: document.body })

  // Waited on by state rather than by markup: the session is held at module scope, so the gate
  // paints the previous test's mode until this one's providers answer, and a wait on what is
  // rendered would pass against the stale one.
  const session = useSession()
  await vi.waitFor(() => {
    expect(session.mode.value).toBe(state.mode)
    expect(session.setupRequired.value).toBe(state.setupRequired === true)
  })

  return wrapper
}

/**
 * Fills the form and submits it.
 * @param {VueWrapper} wrapper - The mounted gate
 * @param {Record<string, string>} values - Field label to value
 * @returns {Promise<void>}
 */
async function submit(wrapper: VueWrapper, values: Record<string, string>): Promise<void> {
  for (const [label, value] of Object.entries(values)) {
    const field = wrapper
      .findAll('label')
      .find((entry) => entry.text().startsWith(label))!
      .find('input')

    await field.setValue(value)
  }

  await wrapper.find('form').trigger('submit')
}

beforeEach(() => {
  calls.length = 0
  localStorage.clear()
  window.location.hash = ''
  resetPortalConfig()
  resetConnectorEntries()
  // Every one of these holds its state at module scope, so it outlives the component that read
  // it and the test that mounted it. Reset before as well as after: a test is only isolated if
  // it does not depend on its predecessor having tidied up.
  resetSession()
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  resetPortalConfig()
  resetConnectorEntries()
  // Also drops the deduped providers load: a test that left one in flight would otherwise hand
  // that same never-settling promise to every test after it.
  resetSession()
  localStorage.clear()
  window.location.hash = ''
  vi.unstubAllGlobals()
})

// Guessing would paint the sign-in button and then replace it with a form, having already
// moved focus to a control that is gone.
describe('before the mode is known', () => {
  it('draws nothing but the brand', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    const wrapper = mount(LoginGate, { attachTo: document.body })

    // The wordmark is a button of its own, so only the controls beside it count.
    const controls = wrapper.findAll('button').filter((button) => !button.classes('brand__home'))

    expect(wrapper.findComponent(CredentialForm).exists()).toBe(false)
    expect(controls).toHaveLength(0)
  })
})

describe('a portal that keeps its own accounts', () => {
  it('offers the password form', async () => {
    const wrapper = await open({ mode: 'local' })
    await vi.waitFor(() => expect(wrapper.findComponent(CredentialForm).exists()).toBe(true))

    expect(wrapper.text()).toContain('Username')
    expect(wrapper.find('button[type="submit"]').text()).toBe('Sign in')
  })

  it('signs in with what was typed', async () => {
    const wrapper = await open({ mode: 'local' })
    await vi.waitFor(() => expect(wrapper.findComponent(CredentialForm).exists()).toBe(true))

    await submit(wrapper, { Username: 'ada', Password: 'a-long-enough-password' })
    await vi.waitFor(() =>
      expect(
        calls.some((call) => call.url.includes('/api/auth/login') && call.method === 'POST'),
      ).toBe(true),
    )

    const login = calls.find((call) => call.url.includes('/api/auth/login'))!
    expect(login.body).toMatchObject({ username: 'ada', password: 'a-long-enough-password' })
  })

  it('shows what the server said when the credentials are refused', async () => {
    const wrapper = await open({
      mode: 'local',
      credentials: { status: 401, body: { error: 'invalid username or password' } },
    })
    await vi.waitFor(() => expect(wrapper.findComponent(CredentialForm).exists()).toBe(true))

    await submit(wrapper, { Username: 'ada', Password: 'wrong' })
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true))

    expect(wrapper.find('[role="alert"]').text()).toBe('invalid username or password')
  })

  // Re-reading the user is the check that the cookie survived: a browser that rejected it
  // leaves this anonymous despite the 200, which is otherwise a silent failure.
  it('says so when the browser did not keep the session cookie', async () => {
    const wrapper = await open({ mode: 'local', signedIn: false })
    await vi.waitFor(() => expect(wrapper.findComponent(CredentialForm).exists()).toBe(true))

    await submit(wrapper, { Username: 'ada', Password: 'a-long-enough-password' })
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true))

    expect(wrapper.find('[role="alert"]').text()).toContain('did not keep the session cookie')
  })
})

describe('a portal nobody has claimed yet', () => {
  it('asks for the first account rather than a sign-in', async () => {
    const wrapper = await open({ mode: 'local', setupRequired: true })
    await vi.waitFor(() => expect(wrapper.findComponent(CredentialForm).exists()).toBe(true))

    expect(wrapper.text()).toContain('This portal has no account yet')
    expect(wrapper.text()).toContain('Setup token')
    expect(wrapper.find('button[type="submit"]').text()).toBe('Create account')
  })

  // Checked here rather than only by the server, since the server never sees the second field.
  it('refuses two passwords that do not match, without asking the server', async () => {
    const wrapper = await open({ mode: 'local', setupRequired: true })
    await vi.waitFor(() => expect(wrapper.findComponent(CredentialForm).exists()).toBe(true))

    await submit(wrapper, {
      Username: 'ada',
      Password: 'a-long-enough-password',
      'Repeat password': 'something-else',
      'Setup token': 'token',
    })

    expect(wrapper.find('[role="alert"]').text()).toBe('the two passwords do not match')
    expect(calls.some((call) => call.url.includes('/api/auth/setup'))).toBe(false)
  })

  it('creates the account and opens the panel, since a fresh portal has nothing to show', async () => {
    const wrapper = await open({ mode: 'local', setupRequired: true })
    await vi.waitFor(() => expect(wrapper.findComponent(CredentialForm).exists()).toBe(true))

    await submit(wrapper, {
      Username: 'ada',
      Password: 'a-long-enough-password',
      'Repeat password': 'a-long-enough-password',
      'Setup token': 'the-token',
    })
    await vi.waitFor(() => expect(window.location.hash).toBe('#/admin'))

    const setup = calls.find((call) => call.url.includes('/api/auth/setup'))!
    expect(setup.body).toMatchObject({ username: 'ada', token: 'the-token' })
  })
})

describe('a portal that signs in elsewhere', () => {
  it('offers the issuer rather than a form', async () => {
    const wrapper = await open({ mode: 'oidc' })

    expect(wrapper.findComponent(CredentialForm).exists()).toBe(false)
    expect(wrapper.text()).toContain('Single Sign-On')
  })

  it('leaves the page for the issuer when asked', async () => {
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign, pathname: '/', search: '', hash: '' },
    })

    const wrapper = await open({ mode: 'oidc' })
    const control = wrapper.findAll('button').find((button) => !button.classes('brand__home'))!

    await control.trigger('click')

    expect(assign).toHaveBeenCalledWith(expect.stringContaining('/api/auth/login?redirect='))
  })
})

// Local mode has nowhere to go: the form is already in this app, so signing in drops the
// cached config instead, which is what brings the gate back on screen.
it('does not navigate away when the portal keeps its own accounts', async () => {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign, pathname: '/', search: '', hash: '' },
  })

  await open({ mode: 'local' })
  useSession().signIn()

  expect(assign).not.toHaveBeenCalled()
})
