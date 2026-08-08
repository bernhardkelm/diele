import { ref, type Ref } from 'vue'
import { ADMIN_EXPORT_URL, ADMIN_IMPORT_URL } from '@/config/api'
import { usePortalConfig } from '@/composables/usePortalConfig'
import { apiMessage, readPayload } from '@/helpers/apiError'

export interface AdminTransferSource {
  busy: Ref<boolean>
  /** What the last export or import did, or why it did not */
  message: Ref<string | undefined>
  failed: Ref<boolean>
  exportSettings: () => Promise<void>
  /** Reads the chosen file and replaces the configuration with it */
  importSettings: (event: Event) => Promise<void>
}

/**
 * Names the export after the portal it came from and the day it was taken, so a folder of
 * them sorts by date and says which deployment each belongs to.
 * @param {string} title - The portal's wordmark
 * @returns {string} - Filename such as `diele-2026-08-07.json`
 */
function exportFilename(title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'diele'

  // built from local parts rather than toISOString, which would name a late-evening export
  // with tomorrow's date
  const now = new Date()
  const day = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')

  return `${slug}-settings-${day}.json`
}

/**
 * Exposes the whole-configuration export and import, so the admin list can offer them as rows
 * rather than owning the fetching itself.
 * @param {() => void} onImported - Called after an import replaced the configuration
 * @returns {AdminTransferSource} - Transfer state and its two actions
 */
export function useAdminTransfer(onImported: () => void): AdminTransferSource {
  const { brand } = usePortalConfig()

  // Per call rather than at module scope: these describe one panel's last action, and nothing
  // else needs to read them. Shared, they would outlive the panel and greet the next one with
  // the previous session's message.
  const busy = ref(false)
  const message = ref<string | undefined>()
  const failed = ref(false)

  /**
   * Downloads the whole configuration as a file, for backup or for seeding another deployment.
   * @returns {Promise<void>}
   */
  async function exportSettings(): Promise<void> {
    busy.value = true
    message.value = undefined
    failed.value = false

    try {
      const response = await fetch(ADMIN_EXPORT_URL, { headers: { accept: 'application/json' } })
      if (!response.ok) {
        throw new Error(`export failed (${response.status})`)
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = exportFilename(brand.value.title)
      anchor.click()
      URL.revokeObjectURL(url)

      message.value = 'exported'
    } catch (cause) {
      failed.value = true
      message.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy.value = false
    }
  }

  /**
   * Replaces the whole configuration with an uploaded file. Destructive, so it asks first: the
   * import wipes what is there rather than merging into it.
   * @param {Event} event - Change event from the file input
   * @returns {Promise<void>}
   */
  async function importSettings(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const chosen = input.files?.[0]
    // cleared straight away, so choosing the same file twice still raises a change event
    input.value = ''

    if (!chosen) {
      return
    }

    if (
      !window.confirm('This replaces every card, saved site, search engine and icon. Continue?')
    ) {
      return
    }

    busy.value = true
    message.value = undefined
    failed.value = false

    try {
      const response = await fetch(ADMIN_IMPORT_URL, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: await chosen.text(),
      })

      const payload = await readPayload(response)

      if (!response.ok) {
        throw new Error(apiMessage(payload, 'import failed'))
      }

      const written = (payload.written ?? {}) as Record<string, number>
      message.value = `imported ${Object.entries(written)
        .map(([key, count]) => `${count} ${key}`)
        .join(', ')}`

      onImported()
    } catch (cause) {
      failed.value = true
      message.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy.value = false
    }
  }

  return { busy, message, failed, exportSettings, importSettings }
}
