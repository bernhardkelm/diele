/**
 * Fills the field with what is already stored, so the page shows the current target rather
 * than an empty box.
 * @returns {Promise<void>}
 */
async function load() {
  document.querySelector('#url').value = await readUrl()
}

/**
 * Validates and stores the typed address, then offers to open it.
 * @param {SubmitEvent} event - Submit event from the form
 * @returns {Promise<void>}
 */
async function save(event) {
  event.preventDefault()

  const field = document.querySelector('#url')
  const error = document.querySelector('#error')
  const saved = document.querySelector('#saved')

  error.hidden = true
  saved.hidden = true

  const url = normaliseUrl(field.value)
  if (!url) {
    error.textContent = 'That is not an http or https address.'
    error.hidden = false
    return
  }

  await writeUrl(url)

  // Written back, so a bare host typed as `diele.example.com` visibly became a full url and
  // nobody wonders whether it was stored as typed.
  field.value = url
  saved.hidden = false
}

/**
 * Opens the stored address in a new tab, so a saved instance can be checked without waiting
 * for the next new tab. Read from storage rather than the field, which may have been edited
 * again since the save.
 * @returns {Promise<void>}
 */
async function openSaved() {
  const url = await readUrl()
  if (url) {
    window.open(url, '_blank', 'noopener')
  }
}

document.querySelector('#form').addEventListener('submit', save)
document.querySelector('#open').addEventListener('click', openSaved)

void load()
