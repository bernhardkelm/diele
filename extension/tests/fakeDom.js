// Just enough of the DOM for the popup's scripts: elements found by class or id, attributes,
// cloning, bubbling events, checkboxes a click toggles, and focus. Selectors are a single
// `.class` or `#id`.

/** An element of the fake document */
export class FakeElement {
  /**
   * Builds an element.
   * @param {{id?: string, classes?: string[], type?: string, hidden?: boolean, attributes?: object}} [spec] -
   *   Its id, classes, input type, whether it starts hidden and its attributes
   * @param {FakeElement[]} [children] - Elements inside it, in document order
   */
  constructor(spec = {}, children = []) {
    this.id = spec.id ?? ''
    this.classes = spec.classes ?? []
    this.type = spec.type ?? ''
    this.hidden = spec.hidden ?? false
    this.attributes = new Map(Object.entries(spec.attributes ?? {}))
    this.dataset = {}
    this.textContent = ''
    this.value = ''
    this.checked = false
    this.disabled = false
    this.title = ''
    this.listeners = {}
    this.parent = undefined
    this.children = []
    this.replaceChildren(...children)
  }

  /**
   * Returns whether the element matches a single class or id selector.
   * @param {string} selector - `.class` or `#id`
   * @returns {boolean} - True on a match
   */
  matches(selector) {
    return selector.startsWith('#')
      ? this.id === selector.slice(1)
      : this.classes.includes(selector.slice(1))
  }

  /**
   * Lists the elements below this one that match, in document order.
   * @param {string} selector - `.class` or `#id`
   * @returns {FakeElement[]} - The matches
   */
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ])
  }

  /**
   * Returns the first element below this one that matches.
   * @param {string} selector - `.class` or `#id`
   * @returns {FakeElement | null} - The match, or null
   */
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  /**
   * Returns this element or its nearest ancestor that matches.
   * @param {string} selector - `.class` or `#id`
   * @returns {FakeElement | null} - The match, or null
   */
  closest(selector) {
    for (let node = this; node; node = node.parent) {
      if (node.matches(selector)) {
        return node
      }
    }

    return null
  }

  /**
   * Replaces the children.
   * @param {...FakeElement} nodes - The new children
   * @returns {void}
   */
  replaceChildren(...nodes) {
    this.children = nodes

    for (const node of nodes) {
      node.parent = this
    }
  }

  /**
   * Copies the element and everything below it, listeners aside.
   * @returns {FakeElement} - The copy
   */
  cloneNode() {
    const copy = new FakeElement(
      {
        id: this.id,
        classes: [...this.classes],
        type: this.type,
        hidden: this.hidden,
        attributes: Object.fromEntries(this.attributes),
      },
      this.children.map((child) => child.cloneNode()),
    )

    copy.textContent = this.textContent
    return copy
  }

  /**
   * Sets an attribute.
   * @param {string} name - Attribute name
   * @param {string} value - Its value
   * @returns {void}
   */
  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  /**
   * Reads an attribute.
   * @param {string} name - Attribute name
   * @returns {string | null} - Its value, or null when unset
   */
  getAttribute(name) {
    return this.attributes.get(name) ?? null
  }

  /**
   * Adds a listener.
   * @param {string} type - Event type
   * @param {Function} listener - What runs
   * @returns {void}
   */
  addEventListener(type, listener) {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener]
  }

  /**
   * Fires an event at this element and bubbles it up through its ancestors.
   * @param {string} type - Event type
   * @param {object} [init] - Further fields of the event, such as `key`
   * @returns {{results: Array<unknown>, defaultPrevented: boolean}} - What each listener
   *   returned, promises included, and whether one prevented the default
   */
  fire(type, init = {}) {
    const event = {
      ...init,
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true
      },
    }
    const results = []

    for (let node = this; node; node = node.parent) {
      for (const listener of node.listeners[type] ?? []) {
        results.push(listener(event))
      }
    }

    return { results, defaultPrevented: event.defaultPrevented }
  }

  /**
   * Clicks the element the way the browser does: nothing on a disabled one, and a checkbox flips
   * before its click and change events go out.
   * @returns {Array<unknown>} - What the listeners returned, promises included
   */
  click() {
    if (this.disabled) {
      return []
    }

    if (this.type !== 'checkbox') {
      return this.fire('click').results
    }

    this.checked = !this.checked
    return [...this.fire('click').results, ...this.fire('change').results]
  }

  /**
   * Takes the focus.
   * @returns {void}
   */
  focus() {
    FakeElement.focused = this
  }
}

/**
 * Builds one row of the switcher the way popup.html's template lays it out.
 * @returns {FakeElement} - The row prototype
 */
function rowPrototype() {
  const element = (classes, children = [], spec = {}) =>
    new FakeElement({ classes, ...spec }, children)
  const check = (box) =>
    element(
      ['check'],
      [
        element(
          ['check__control'],
          [element(['check__input', box], [], { type: 'checkbox' }), element(['check__box'])],
        ),
        element(['check__text']),
      ],
    )

  return element(
    ['row'],
    [
      element(
        ['row__choice'],
        [
          element(['row__radio'], [], { type: 'radio' }),
          element(['row__name']),
          element(['row__detail']),
        ],
      ),
      element(['row__remove']),
      element(
        ['row__history'],
        [
          check('row__toggle'),
          element(['row__status', 'truncate']),
          element(['row__status-more', 'visually-hidden']),
        ],
      ),
      element(
        ['row__history', 'row__history--titles'],
        [check('row__titles'), element(['row__status', 'row__titles-status', 'truncate'])],
        { hidden: true },
      ),
    ],
  )
}

/**
 * Builds the popup's document: the elements popup.js looks up by id, and the row template.
 * @returns {{document: object, byId: (id: string) => FakeElement}} - The document and a lookup
 */
export function fakePopupDocument() {
  const ids = [
    'list',
    'switcher',
    'empty',
    'footer',
    'target',
    'name',
    'url',
    'error',
    'history-note',
    'add',
    'open',
  ]
  const elements = new Map(ids.map((id) => [id, new FakeElement({ id })]))
  const template = new FakeElement({ id: 'row' })

  template.content = { firstElementChild: rowPrototype() }
  elements.set('row', template)

  const document = {
    querySelector: (selector) => elements.get(selector.slice(1)) ?? null,
  }

  return { document, byId: (id) => elements.get(id) }
}
