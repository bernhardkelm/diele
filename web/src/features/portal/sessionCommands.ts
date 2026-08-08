import type { CommandTarget } from '@/types/portal'

export interface SessionControls {
  /** Ends the session and returns to the login screen */
  signOut: () => void
  /** Who is signed in, so the entry can name them */
  name: string | null
}

const KEYWORDS = ['sign', 'signout', 'out', 'logout', 'log', 'session', 'auth', 'login']

/**
 * Builds the entry that ends the session, which the bar answers to as `/logout`.
 * @param {string} label - How the entry names itself
 * @param {SessionControls} controls - The session and how to end it
 * @returns {CommandTarget} - The entry
 */
export function signOutCommand(label: string, controls: SessionControls): CommandTarget {
  return {
    ref: 'cmd:logout',
    kind: 'command',
    name: label,
    url: '',
    hint: controls.name ? `ends the session for ${controls.name}` : 'ends the session',
    keywords: KEYWORDS,
    searchOnly: true,
    run: () => controls.signOut(),
  }
}
