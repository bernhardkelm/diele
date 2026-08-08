export interface KeyHint {
  readonly text: string
  /** Marks a hint a phone has no keyboard for, so the launcher bar can drop it */
  readonly key?: boolean
}

/** What the search field answers to in a view whose list is walked by the arrows. */
export const FIELD_HINTS: ReadonlyArray<KeyHint> = [
  { text: '↑↓ selects', key: true },
  { text: '↵ opens', key: true },
  { text: 'esc leaves' },
]

export const LEAVE_HINT: KeyHint = { text: 'esc leaves' }
