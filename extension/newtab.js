// Chrome only lets chrome_url_overrides point at a page inside the extension, so the new tab
// page is this redirect rather than the target url itself.

/**
 * Sends the tab to the configured instance, or paints the setup form when there is none.
 *
 * The form lives in a <template> and is only stamped out on the second path, so a configured
 * browser never renders markup it is about to navigate away from.
 * @returns {Promise<void>}
 */
async function open() {
  const url = await readUrl()

  if (url) {
    // replace(), not assign(), so this redirect page stays out of the tab's back history
    location.replace(url)
    return
  }

  document.body.append(document.querySelector('#setup').content)
  document.querySelector('#form').addEventListener('submit', save)
  document.querySelector('#url').focus()
}

/**
 * Saves what was typed and opens it, so the first new tab is also the last setup step. It is
 * stored unnamed: the row shows its hostname, and naming matters only once there are several.
 * @param {SubmitEvent} event - Submit event from the setup form
 * @returns {Promise<void>}
 */
async function save(event) {
  event.preventDefault()

  const error = document.querySelector('#error')
  const url = normaliseUrl(document.querySelector('#url').value)

  if (!url) {
    error.textContent = 'That is not an http or https address.'
    error.hidden = false
    return
  }

  await addInstance('', url)
  location.replace(url)
}

void open()
