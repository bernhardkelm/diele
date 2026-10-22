import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { fakePopupDocument } from './fakeDom.js'
import { loadScripts } from './load.js'
import { INSTANCE, RECORDING, TARGET, memoryArea } from './worker.js'

const SYNC = {
  dieleInstances: [
    { id: 'one', name: 'home', url: INSTANCE },
    { id: 'two', name: 'lan', url: 'http://diele.lan/' },
  ],
  dieleActiveId: 'one',
}

/**
 * Copies a value out of the scripts' realm, so deep comparisons do not trip over its prototypes.
 * @param {unknown} value - Value made inside the context
 * @returns {unknown} - The same data, made here
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Lets the popup's promise chains run to the end.
 * @returns {Promise<void>}
 */
async function flush() {
  for (let turn = 0; turn < 10; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

/**
 * Opens the popup in a fake document, with the prompt's answer and the worker's replies given.
 * @param {object} local - What chrome.storage.local starts with
 * @param {{granted?: boolean | (() => Promise<boolean>), reply?: Function}} [browser] - Whether
 *   a permission prompt is granted, or what answers it, and how the worker answers a message,
 *   free to change storage the way the worker would
 * @returns {Promise<object>} - The scope, the document lookup, storage and what was asked for
 */
async function openPopup(local, browser = {}) {
  const { document, byId } = fakePopupDocument()
  const requests = []
  const messages = []
  const chrome = {
    runtime: {
      id: 'ext',
      getURL: (path) => `chrome-extension://ext/${path}`,
      sendMessage: async (message) => {
        messages.push(message)
        return browser.reply ? browser.reply(message, local) : undefined
      },
    },
    permissions: {
      request: (asked) => {
        requests.push(asked)
        return typeof browser.granted === 'function'
          ? browser.granted()
          : Promise.resolve(browser.granted ?? true)
      },
    },
    storage: {
      local: memoryArea(local),
      sync: memoryArea(structuredClone(SYNC)),
      onChanged: { addListener: () => undefined },
    },
  }
  const scripts = loadScripts(
    [
      'storage.js',
      'history/keys.js',
      'history/scope.js',
      'history/state.js',
      'popupHistory.js',
      'popup.js',
    ],
    { chrome, document, window: { open: () => undefined }, structuredClone },
  )

  await flush()
  return { scripts, byId, local, requests, messages }
}

/**
 * Finds a row of the list by its instance.
 * @param {(id: string) => object} byId - The document lookup
 * @param {string} id - The row's instance
 * @returns {object} - The row
 */
function rowOf(byId, id) {
  return byId('list')
    .querySelectorAll('.row')
    .find((row) => row.dataset.id === id)
}

test('each row paints its switch, an http instance disabled and saying why', async () => {
  const { byId } = await openPopup({})
  const home = rowOf(byId, 'one')
  const lan = rowOf(byId, 'two')

  assert.equal(home.querySelector('.row__toggle').checked, false)
  assert.equal(home.querySelector('.row__toggle').disabled, false)
  assert.equal(home.querySelector('.row__toggle').getAttribute('aria-label'), 'History for home')
  assert.equal(home.querySelector('.row__status').textContent, 'off')
  assert.equal(home.querySelector('.row__history--titles').hidden, true)
  assert.equal(lan.querySelector('.row__toggle').disabled, true)
  assert.equal(lan.querySelector('.row__status').textContent, 'needs https')
  assert.match(lan.querySelector('.row__status-more').textContent, /in the clear/)
  assert.equal(byId('history-note').hidden, false)
})

test('a recording target shows what waits, and its titles switch', async () => {
  const { byId } = await openPopup({
    dieleHistoryTarget: { ...TARGET, titles: true },
    dieleHistoryState: RECORDING,
    dieleHistoryBuffer: { visits: [{}, {}] },
  })
  const home = rowOf(byId, 'one')

  assert.equal(home.querySelector('.row__toggle').checked, true)
  assert.equal(home.querySelector('.row__status').textContent, 'recording, 2 waiting')
  assert.equal(home.querySelector('.row__titles-status').textContent, 'sent')
  assert.equal(home.querySelector('.row__history--titles').hidden, false)
  assert.equal(home.querySelector('.row__titles').checked, true)
  assert.equal(rowOf(byId, 'two').querySelector('.row__status').textContent, 'needs https')
})

test('every status the instance can report reads as a few words of its own', async () => {
  for (const [cached, line, more] of [
    [undefined, 'open a diele tab once', /not seen this instance yet/],
    [{ ...RECORDING, signedIn: false }, 'signed out', /sign in/],
    [{ ...RECORDING, extension: false }, 'not accepted here', /does not accept visits/],
    [{ ...RECORDING, available: false }, 'not accepted here', /does not accept visits/],
    [{ ...RECORDING, refused: true }, 'not accepted here', /does not accept visits/],
    [{ ...RECORDING, enabled: false }, 'not opted in', /opt in/],
    [{ ...RECORDING, account: undefined }, 'not opted in', /opt in/],
    [{ instance: INSTANCE, unrecognised: true }, 'not diele', /does not answer like diele/],
    [{ ...RECORDING, unrecognised: true }, 'not diele', /does not answer like diele/],
    [RECORDING, 'recording', /^$/],
  ]) {
    const { byId } = await openPopup({ dieleHistoryTarget: TARGET, dieleHistoryState: cached })
    const home = rowOf(byId, 'one')

    assert.equal(home.querySelector('.row__status').textContent, line)
    assert.match(home.querySelector('.row__status-more').textContent, more)
    assert.equal(
      home.querySelector('.row__toggle').getAttribute('aria-describedby'),
      'history-one history-more-one',
    )
  }
})

// The browser only shows a permission prompt inside the gesture's own turn
test('checking the box asks for access in its handler, then has the worker finish', async () => {
  const world = await openPopup(
    {},
    {
      reply: (message, local) => {
        local.dieleHistoryTarget = { id: message.id, url: INSTANCE, titles: false }
        return { active: true, outcome: 'active' }
      },
    },
  )
  const toggle = rowOf(world.byId, 'one').querySelector('.row__toggle')

  const handled = toggle.click()
  assert.equal(toggle.checked, true)
  assert.equal(world.requests.length, 1)
  assert.deepEqual(plain(world.requests[0]), {
    permissions: ['webNavigation', 'scripting'],
    origins: [`${INSTANCE}*`],
  })
  assert.equal(world.local.dieleHistoryPending.id, 'one')

  await Promise.all(handled)
  await flush()

  assert.deepEqual(plain(world.messages), [{ kind: 'history:activate', id: 'one' }])
  assert.equal(world.byId('error').hidden, true)
  assert.equal(toggle.checked, true)
  assert.equal(rowOf(world.byId, 'one').querySelector('.row__history--titles').hidden, false)
})

test('Enter toggles the box too, and the request still leaves within the key press', async () => {
  const world = await openPopup({}, { reply: () => ({ active: true, outcome: 'active' }) })
  const toggle = rowOf(world.byId, 'one').querySelector('.row__toggle')

  const { defaultPrevented } = toggle.fire('keydown', { key: 'Enter' })

  assert.equal(defaultPrevented, true)
  assert.equal(toggle.checked, true)
  assert.equal(world.requests.length, 1)

  toggle.fire('keydown', { key: 'a' })
  assert.equal(world.requests.length, 1)
  await flush()
})

test('a disabled box ignores both the click and Enter', async () => {
  const world = await openPopup({})
  const lan = rowOf(world.byId, 'two').querySelector('.row__toggle')

  lan.click()
  const { defaultPrevented } = lan.fire('keydown', { key: 'Enter' })
  await flush()

  assert.equal(defaultPrevented, false)
  assert.equal(lan.checked, false)
  assert.equal(world.requests.length, 0)
})

test('a declined prompt unchecks the box, says why and leaves no pending switch', async () => {
  const world = await openPopup({}, { granted: false })
  const toggle = rowOf(world.byId, 'one').querySelector('.row__toggle')

  await Promise.all(toggle.click())
  await flush()

  assert.equal(world.messages.length, 0)
  assert.equal(world.local.dieleHistoryPending, undefined)
  assert.equal(toggle.checked, false)
  assert.equal(rowOf(world.byId, 'one').querySelector('.row__status').textContent, 'no access')
})

test('a box stays as clicked while the prompt is open, whatever a repaint reads', async () => {
  let answer
  const world = await openPopup({}, { granted: () => new Promise((resolve) => (answer = resolve)) })
  const toggle = rowOf(world.byId, 'one').querySelector('.row__toggle')

  const handled = toggle.click()
  world.scripts.paintHistory()
  assert.equal(toggle.checked, true)

  answer(false)
  await Promise.all(handled)
  await flush()
  assert.equal(toggle.checked, false)
})

test('a request the browser throws on unchecks the box and says so in its status', async () => {
  const world = await openPopup({}, { granted: () => Promise.reject(new Error('no gesture')) })
  const toggle = rowOf(world.byId, 'one').querySelector('.row__toggle')

  await Promise.all(toggle.click())
  await flush()

  assert.equal(toggle.checked, false)
  assert.equal(
    rowOf(world.byId, 'one').querySelector('.row__status').textContent,
    'could not switch on',
  )
  assert.equal(world.byId('error').hidden, false)
})

test('a switch the worker could not finish says that, not that access was denied', async () => {
  for (const [outcome, line] of [
    ['failed', /^could not switch on$/],
    ['refused', /^no access$/],
  ]) {
    const world = await openPopup({}, { reply: () => ({ active: false, outcome }) })
    const toggle = rowOf(world.byId, 'one').querySelector('.row__toggle')

    await Promise.all(toggle.click())
    await flush()

    const status = rowOf(world.byId, 'one').querySelector('.row__status').textContent
    assert.equal(toggle.checked, false, outcome)
    assert.match(status, line, outcome)
  }
})

test('unchecking asks for nothing and has the worker give everything back', async () => {
  const world = await openPopup(
    { dieleHistoryTarget: TARGET, dieleHistoryState: RECORDING },
    {
      reply: (_message, local) => {
        delete local.dieleHistoryTarget
        return { active: false }
      },
    },
  )
  const toggle = rowOf(world.byId, 'one').querySelector('.row__toggle')

  await Promise.all(toggle.click())
  await flush()

  assert.equal(world.requests.length, 0)
  assert.deepEqual(plain(world.messages), [{ kind: 'history:deactivate' }])
  assert.equal(world.byId('error').hidden, true)
  assert.equal(toggle.checked, false)
  assert.equal(rowOf(world.byId, 'one').querySelector('.row__status').textContent, 'off')
})

test('the titles box asks for tabs alone, and unchecks with the reason when it fails', async () => {
  for (const [granted, reply, notice] of [
    [true, { titles: true }, undefined],
    [false, undefined, /^no access$/],
    [true, { titles: false }, /^could not switch on$/],
  ]) {
    const world = await openPopup(
      { dieleHistoryTarget: TARGET, dieleHistoryState: RECORDING },
      {
        granted,
        reply: (_message, local) => {
          local.dieleHistoryTarget = { ...TARGET, titles: reply?.titles === true }
          return reply
        },
      },
    )
    const titles = rowOf(world.byId, 'one').querySelector('.row__titles')

    const handled = titles.click()
    assert.deepEqual(plain(world.requests), [{ permissions: ['tabs'] }])
    await Promise.all(handled)
    await flush()

    const status = rowOf(world.byId, 'one').querySelector('.row__titles-status').textContent
    assert.equal(titles.checked, notice === undefined)

    if (notice === undefined) {
      assert.deepEqual(plain(world.messages), [{ kind: 'history:titles', id: 'one' }])
      assert.equal(status, 'sent')
    } else {
      assert.match(status, notice)
    }
  }
})

test('titles unchecked ask the worker and nothing else', async () => {
  const world = await openPopup(
    { dieleHistoryTarget: { ...TARGET, titles: true }, dieleHistoryState: RECORDING },
    { reply: () => ({ titles: false }) },
  )
  const titles = rowOf(world.byId, 'one').querySelector('.row__titles')

  await Promise.all(titles.click())
  await flush()

  assert.equal(world.requests.length, 0)
  assert.deepEqual(plain(world.messages), [{ kind: 'history:untitled' }])
})

test('the note ends with a link to the History section, opened in a new tab', () => {
  const page = readFileSync(new URL('../popup.html', import.meta.url), 'utf8')
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  const note = /<p id="history-note"[\s\S]*?<\/p>/.exec(page)[0]
  const link = /<a\s([^>]*)>/.exec(note)[1]

  assert.match(
    link,
    /href="https:\/\/github\.com\/bernhardkelm\/diele\/blob\/main\/extension\/README\.md#history"/,
  )
  assert.match(link, /target="_blank"/)
  assert.match(link, /rel="noopener noreferrer"/)
  assert.match(readme, /^## History$/m)
})

test('each box is a real checkbox inside the label that names it', () => {
  const page = readFileSync(new URL('../popup.html', import.meta.url), 'utf8')

  for (const [box, text] of [
    ['row__toggle', 'history'],
    ['row__titles', 'titles'],
  ]) {
    const label = new RegExp(
      `<label class="check">[\\s\\S]*?<input class="check__input ${box}" type="checkbox" />` +
        `[\\s\\S]*?<span class="check__text">${text}</span>\\s*</label>`,
    )
    assert.match(page, label, box)
  }
})

test('the note is one short line and the link, nothing about titles', () => {
  const page = readFileSync(new URL('../popup.html', import.meta.url), 'utf8')
  const note = /<p id="history-note"[^>]*>([\s\S]*?)<\/p>/.exec(page)[1]
  const text = note
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  assert.equal(text, 'Sends the pages you load to one instance, origin and path only. How it works')
  assert.doesNotMatch(page, /history-note-titles/)
})

// The popup is 22rem wide inside 1.5rem of padding, a row sets in 1.5rem for its marker, the
// glyph column takes 2rem and the gap 0.5rem; at 0.75rem a mono character is about 0.45rem
// wide. A nested row loses another glyph column.
test('every status fits on the line beside its label at the popup width', async () => {
  const perChar = 0.45
  const column = 2
  const room = (22 - 3 - 1.5 - column - 0.5) / perChar
  const { scripts } = await openPopup({})

  const read = (name) => vm.runInContext(name, scripts)

  for (const text of Object.values(read('HISTORY_STATUS_TEXT'))) {
    assert.ok('history'.length + text.length <= room, text)
  }

  assert.ok('history'.length + 'recording, 500 waiting'.length <= room)

  for (const text of Object.values(read('HISTORY_TITLES_TEXT'))) {
    assert.ok('titles'.length + text.length <= room - column / perChar, text)
  }
})
