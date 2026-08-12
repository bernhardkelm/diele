import { ref, type Ref } from 'vue'
import { ADMIN_ICONS_URL } from '@/config/api'
import { refreshPortalConfig } from '@/composables/usePortalConfig'
import { apiMessage, readPayload } from '@/helpers/apiError'
import type { ApiIcon } from '@diele/common'

export interface IconLibrary {
  icons: Ref<ReadonlyArray<ApiIcon>>
  error: Ref<string | undefined>
  busy: Ref<boolean>
  load: () => Promise<void>
  /** Uploads an svg and returns the stored icon, or undefined when it was rejected */
  upload: (file: File) => Promise<ApiIcon | undefined>
  /** Deletes an icon and answers whether it went through */
  remove: (id: number) => Promise<boolean>
  svgFor: (id: number | null | undefined) => string
}

const icons = ref<ReadonlyArray<ApiIcon>>([])
const error = ref<string | undefined>()
const busy = ref(false)

let loaded = false

/**
 * Drops the library, so the next reader fetches it again. The sibling of `resetPortalConfig`,
 * `resetConnectorEntries` and `resetSession`: all of them hold state at module scope, which
 * outlives every component that reads it.
 * @returns {void}
 */
export function resetIcons(): void {
  icons.value = []
  error.value = undefined
  busy.value = false
  loaded = false
}

/**
 * Holds the uploaded icon library. Shared, because every card's icon field draws from the
 * same set and a second field asking must not mean a second request.
 * @returns {IconLibrary} - Reactive icons and their controls
 */
export function useIcons(): IconLibrary {
  /**
   * Loads the library, once unless something has been uploaded since.
   * @returns {Promise<void>}
   */
  async function load(): Promise<void> {
    if (loaded) {
      return
    }

    try {
      const response = await fetch(ADMIN_ICONS_URL, { headers: { accept: 'application/json' } })
      if (!response.ok) {
        return
      }

      const payload = (await response.json()) as { icons?: ApiIcon[] }
      icons.value = payload.icons ?? []
      loaded = true
    } catch {
      // an unreachable library only costs the picker, not the rest of the form
    }
  }

  /**
   * Sends an svg to be sanitised and stored, and adds it to the library on success.
   * @param {File} file - Chosen svg file
   * @returns {Promise<ApiIcon | undefined>} - The stored icon, or undefined when rejected
   */
  async function upload(file: File): Promise<ApiIcon | undefined> {
    busy.value = true
    error.value = undefined

    try {
      const svg = await file.text()
      const name = file.name.replace(/\.svg$/i, '')

      const response = await fetch(ADMIN_ICONS_URL, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ name, svg }),
      })

      const payload = await readPayload(response)
      const icon = payload.icon as ApiIcon | undefined

      if (!response.ok || !icon) {
        throw new Error(apiMessage(payload, 'upload failed'))
      }

      icons.value = [...icons.value, icon]
      return icon
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      return undefined
    } finally {
      busy.value = false
    }
  }

  /**
   * Deletes an icon. The card referencing it is not deleted with it, the reference is cleared,
   * so every page painting that card is now showing a logo the database no longer holds and the
   * configuration has to be read again.
   * @param {number} id - Icon to delete
   * @returns {Promise<boolean>} - True when it went through
   */
  async function remove(id: number): Promise<boolean> {
    busy.value = true
    error.value = undefined

    try {
      const response = await fetch(`${ADMIN_ICONS_URL}/${id}`, {
        method: 'DELETE',
        headers: { accept: 'application/json' },
      })

      if (!response.ok) {
        throw new Error(apiMessage(await readPayload(response), 'delete failed'))
      }

      icons.value = icons.value.filter((icon) => icon.id !== id)
      await refreshPortalConfig()

      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      return false
    } finally {
      busy.value = false
    }
  }

  /**
   * Returns the markup of one icon, for the preview beside the picker.
   * @param {number | null | undefined} id - Icon to look up
   * @returns {string} - Sanitised svg markup, empty when there is none
   */
  function svgFor(id: number | null | undefined): string {
    if (id == null) {
      return ''
    }

    return icons.value.find((icon) => icon.id === id)?.svg ?? ''
  }

  return { icons, error, busy, load, upload, remove, svgFor }
}
