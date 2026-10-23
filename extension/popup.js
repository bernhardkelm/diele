// The toolbar popup, and the options page: manifest v3 lets one page be both, and two surfaces
// for the same list would only drift apart.

const list = document.querySelector('#list')
const switcher = document.querySelector('#switcher')
const empty = document.querySelector('#empty')
const footer = document.querySelector('#footer')
const target = document.querySelector('#target')
const rowTemplate = document.querySelector('#row')
const nameField = document.querySelector('#name')
const urlField = document.querySelector('#url')
const error = document.querySelector('#error')
const historyNote = document.querySelector('#history-note')

let state = { instances: [], activeId: '' }

// Sync storage rejects past a write rate that holding an arrow key down in the group can reach
const REFUSED = 'The browser refused that write. Sync storage allows a limited number per minute.'

// Which status a row's box shows when it could not be switched on, by what went wrong
const HISTORY_SWITCH_NOTICES = {
  denied: 'noAccess',
  refused: 'noAccess',
  failed: 'failed',
  thrown: 'failed',
}
const TITLES_SWITCH_NOTICES = {
  denied: 'noAccess',
  failed: 'failed',
  thrown: 'failed',
}

/**
 * Returns what a row calls an instance: its name, or the host it points at when it has none.
 * @param {{name: string, url: string}} instance - Instance to label
 * @returns {string} - The name, or the hostname with its port
 */
function labelFor(instance) {
  return instance.name || addressOf(instance)
}

/**
 * Returns the address of an instance without its scheme, which is noise in a column this narrow.
 * @param {{url: string}} instance - Instance to describe
 * @returns {string} - Host, port and path, without a trailing lone slash
 */
function addressOf(instance) {
  const parsed = new URL(instance.url)
  return parsed.pathname === '/' ? parsed.host : `${parsed.host}${parsed.pathname}`
}

/**
 * Returns what the second column shows, which is nothing when the name is already the address.
 * @param {{name: string, url: string}} instance - Instance to describe
 * @returns {string} - The address, or an empty string when the row would repeat itself
 */
function detailFor(instance) {
  const address = addressOf(instance)
  return address === labelFor(instance) ? '' : address
}

/**
 * Builds one row of the switcher.
 *
 * Every value is assigned through textContent rather than markup: a name is arbitrary input, and
 * this page runs with extension privileges.
 * @param {{id: string, name: string, url: string}} instance - Instance the row stands for
 * @returns {HTMLLIElement} - The row, ready to append
 */
function buildRow(instance) {
  const row = rowTemplate.content.firstElementChild.cloneNode(true)
  const radio = row.querySelector('.row__radio')
  const removeButton = row.querySelector('.row__remove')
  const label = labelFor(instance)

  row.dataset.id = instance.id
  radio.value = instance.id
  radio.checked = instance.id === state.activeId
  row.querySelector('.row__name').textContent = label
  row.querySelector('.row__detail').textContent = detailFor(instance)

  removeButton.dataset.id = instance.id
  // The glyph is the same on every row, so the row it belongs to has to be in the name
  removeButton.setAttribute('aria-label', `Remove ${label}`)
  removeButton.title = `Remove ${label}`

  paintHistoryControls(row, instance, label)
  return row
}

/**
 * Repaints every row's history switch in place, so a change the worker made while the popup is
 * open shows without the rows being replaced under the focus.
 * @returns {void}
 */
function paintHistory() {
  for (const row of list.querySelectorAll('.row')) {
    const instance = state.instances.find((entry) => entry.id === row.dataset.id)
    if (instance) {
      paintHistoryControls(row, instance, labelFor(instance))
    }
  }
}

/**
 * Names the instance new tabs currently open. Its live region is the only announcement a switch
 * makes, so it is written on every switch, not only on a repaint.
 * @returns {void}
 */
function showTarget() {
  const active = state.instances.find((instance) => instance.id === state.activeId)
  target.textContent = active ? `New tabs open ${labelFor(active)}.` : ''
}

/**
 * Paints the list and the pieces that only make sense beside one.
 * @param {{instances: Array<{id: string, name: string, url: string}>, activeId: string}} next -
 *   The state to show, as returned by storage
 * @returns {void}
 */
function render(next) {
  state = next

  const filled = state.instances.length > 0
  list.replaceChildren(...state.instances.map((instance) => buildRow(instance)))
  switcher.hidden = !filled
  empty.hidden = filled
  footer.hidden = !filled
  historyNote.hidden = !filled
  showTarget()
}

/**
 * Shows why an address was refused.
 * @param {string} message - What to tell the user
 * @returns {void}
 */
function showError(message) {
  error.textContent = message
  error.hidden = false
}

/**
 * Points new tabs at the instance whose row was picked.
 *
 * Deliberately does not re-render: the radio group already shows the change, and replacing the
 * rows would drop the focus the arrow keys just moved.
 * @param {Event} event - Change event from the list
 * @returns {Promise<void>}
 */
async function switchTo(event) {
  if (!event.target.matches('.row__radio')) {
    return
  }

  error.hidden = true

  try {
    state = await setActiveInstance(event.target.value)
  } catch {
    showError(REFUSED)
    return
  }

  showTarget()
}

/**
 * Removes the instance whose row was dismissed, then puts focus where the row used to be, so a
 * second removal does not start from the top of the popup.
 * @param {MouseEvent} event - Click event from the list
 * @returns {Promise<void>}
 */
async function removeRow(event) {
  const button = event.target.closest('.row__remove')
  if (!button) {
    return
  }

  error.hidden = true
  const index = state.instances.findIndex((instance) => instance.id === button.dataset.id)

  try {
    render(await removeInstance(button.dataset.id))
  } catch {
    showError(REFUSED)
    return
  }

  const radios = list.querySelectorAll('.row__radio')
  if (radios.length === 0) {
    urlField.focus()
    return
  }

  radios[Math.min(index, radios.length - 1)].focus()
}

/**
 * Switches history on for the row's instance, or off, as its box now says. The permission request
 * has to leave inside the gesture, so nothing is awaited before switchHistoryOn is called; when
 * the switch does not go on, the repaint unchecks the box and its status says why.
 * @param {Event} event - Change event from the list
 * @returns {Promise<void>}
 */
async function toggleHistory(event) {
  const toggle = event.target.closest('.row__toggle')
  const instance = toggle && state.instances.find((entry) => entry.id === toggle.dataset.id)
  if (!instance) {
    return
  }

  error.hidden = true
  beginHistorySwitch('history', instance.id)
  let notice

  try {
    const outcome = toggle.checked ? await switchHistoryOn(instance) : await switchHistoryOff()
    notice = HISTORY_SWITCH_NOTICES[outcome]
  } catch {
    notice = HISTORY_SWITCH_NOTICES.thrown
    showError('History could not be switched. Try again from the toolbar button.')
  }

  endHistorySwitch('history', instance.id, notice)
  await readHistoryView()
  paintHistory()
}

/**
 * Switches page titles on for the target row, or off, as its box now says. Like the history box,
 * the permission request leaves inside the gesture.
 * @param {Event} event - Change event from the list
 * @returns {Promise<void>}
 */
async function toggleTitles(event) {
  const toggle = event.target.closest('.row__titles')
  const instance = toggle && state.instances.find((entry) => entry.id === toggle.dataset.id)
  if (!instance) {
    return
  }

  error.hidden = true
  beginHistorySwitch('titles', instance.id)
  let notice

  try {
    const outcome = toggle.checked ? await switchTitlesOn(instance) : await switchTitlesOff()
    notice = TITLES_SWITCH_NOTICES[outcome]
  } catch {
    notice = TITLES_SWITCH_NOTICES.thrown
    showError('Titles could not be switched. Try again from the toolbar button.')
  }

  endHistorySwitch('titles', instance.id, notice)
  await readHistoryView()
  paintHistory()
}

/**
 * Toggles a history or titles box on Enter. Space toggles a checkbox natively and Enter does
 * nothing, which leaves the key that means "do it" everywhere else dead on these rows. The click
 * it makes runs inside the key press, so a permission prompt may still open from it.
 * @param {KeyboardEvent} event - Key press from the list
 * @returns {void}
 */
function toggleOnEnter(event) {
  const box = event.target
  const isBox = box.matches('.row__toggle') || box.matches('.row__titles')

  if (event.key !== 'Enter' || !isBox || box.disabled) {
    return
  }

  event.preventDefault()
  box.click()
}

/**
 * Validates and adds what was typed. The refusals are separate messages because a duplicate and
 * a typo are different mistakes and only one of them is worth retyping.
 * @param {SubmitEvent} event - Submit event from the add form
 * @returns {Promise<void>}
 */
async function add(event) {
  event.preventDefault()
  error.hidden = true

  const url = normaliseUrl(urlField.value)
  if (!url) {
    showError('That is not an http or https address.')
    return
  }

  if (state.instances.some((instance) => instance.url === url)) {
    showError('That address is already in the list.')
    return
  }

  if (state.instances.length >= MAX_INSTANCES) {
    showError(`That is ${MAX_INSTANCES} instances, which is as many as this holds.`)
    return
  }

  try {
    render(await addInstance(nameField.value, url))
  } catch {
    showError(REFUSED)
    return
  }

  nameField.value = ''
  urlField.value = ''
  nameField.focus()
}

/**
 * Opens the active instance in a new tab, so a switch can be checked without waiting for the
 * next new tab. Read from storage rather than the rendered list, which the click may have
 * changed since.
 * @returns {Promise<void>}
 */
async function openActive() {
  const url = await readUrl()
  if (url) {
    window.open(url, '_blank', 'noopener')
  }
}

/**
 * Fills the popup with what is stored.
 * @returns {Promise<void>}
 */
async function load() {
  await readHistoryView()
  render(await readState())
}

// Delegated, so the handlers survive a re-render without being bound to every row again
list.addEventListener('change', switchTo)
list.addEventListener('change', toggleHistory)
list.addEventListener('change', toggleTitles)
list.addEventListener('keydown', toggleOnEnter)
list.addEventListener('click', removeRow)
document.querySelector('#add').addEventListener('submit', add)
document.querySelector('#open').addEventListener('click', openActive)

// The worker finishes a switch, and the relay reports, while the popup may be open
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') {
    void readHistoryView().then(paintHistory)
  }
})

void load()
