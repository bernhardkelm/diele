import { FIELD_HINTS, LEAVE_HINT, type KeyHint } from '@/helpers/keyHints'
import type { SettingsStation } from '@/features/settings/settingsStations'

/**
 * Names the keys whatever holds focus answers to.
 *
 * Built from the station rather than from the view, the same way the admin panel does it:
 * naming a key that does nothing is worse than naming none, since the only way to find out
 * is to press it.
 * @param {SettingsStation | undefined} station - Station holding focus, or undefined for the field
 * @param {boolean} expanded - Whether a section station is already open
 * @returns {ReadonlyArray<KeyHint>} - Hints to render under the search field
 */
export function settingsHintsFor(
  station: SettingsStation | undefined,
  expanded: boolean,
): ReadonlyArray<KeyHint> {
  if (!station) {
    return FIELD_HINTS
  }

  if (station.kind === 'option') {
    return [{ text: '↵ turns it on/off', key: true }, { text: 'd on/off', key: true }, LEAVE_HINT]
  }

  if (station.kind === 'action') {
    return [{ text: '↵ runs', key: true }, LEAVE_HINT]
  }

  return [{ text: expanded ? '↵ closes' : '↵ opens', key: true }, LEAVE_HINT]
}
