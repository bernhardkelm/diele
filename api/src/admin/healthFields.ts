import type { ApiFieldOption, ApiFieldSpec } from '@diele/common'
import { config } from '#config.js'
import { messageOf, redactSecrets } from '#connectors/redact.js'
import { listModules } from '#connectors/registry.js'
import {
  listEnabledConnectors,
  recordHealthRead,
  type ConnectorRecord,
} from '#connectors/repository.js'
import type { ConnectorModule } from '#connectors/types.js'
import { readSecrets } from '#secrets/repository.js'
import { HTTP_SELECTOR_FIELD } from '#health/httpProbe.js'
import { HTTP_PROVIDER, providerValue } from '#health/providers.js'
import { isEnabled } from '#settings/toggles.js'
import { HEALTH_KEY } from './healthSelector.js'

// Short, because this sits in front of the admin panel painting. A source that is slower than
// this falls back to the typed box rather than holding the form.
const TARGETS_TIMEOUT_MS = 5_000

/** Kept first, so the dropdown still offers what a blank box used to mean. */
const AUTOMATIC: ApiFieldOption = { value: '', label: 'match automatically' }

/**
 * Asks one instance what it can be bound to, for a source that can say.
 *
 * A failure is not raised: this runs while the panel is being painted, and an instance that is
 * unreachable for a moment should cost its dropdown, not the whole form.
 * @param {ConnectorModule} module - Module the instance belongs to
 * @param {ConnectorRecord} instance - Instance to ask
 * @returns {Promise<ReadonlyArray<ApiFieldOption> | undefined>} - Its targets, or undefined
 */
async function targetsOf(
  module: ConnectorModule,
  instance: ConnectorRecord,
): Promise<ReadonlyArray<ApiFieldOption> | undefined> {
  if (!module.listHealthTargets) {
    return undefined
  }

  if (!config.secrets.available && module.secretKeys.length > 0) {
    return undefined
  }

  try {
    return await module.listHealthTargets({
      id: instance.id,
      label: instance.label,
      config: instance.config,
      secrets: readSecrets(instance.id),
      signal: AbortSignal.timeout(TARGETS_TIMEOUT_MS),
      cursor: null,
    })
  } catch (cause) {
    const error = redactSecrets(messageOf(cause), readSecrets(instance.id))

    // Recorded on the row as well as logged. Nothing else reaches a decorator that has yet to be
    // bound to anything, so without this a connector pointed at an address that does not answer
    // reads as merely unused until someone binds an entry to find out.
    recordHealthRead(instance.id, error)

    // Named, because the form silently degrading to a typed box looks like it never offered one
    console.warn(
      `[health] ${module.type}/${instance.label} could not list what it monitors:`,
      error,
    )

    return undefined
  }
}

/**
 * Builds the liveness fields an entry carries: which provider answers for it, and whatever that
 * provider needs to recognise it.
 *
 * Both are assembled per request rather than declared once, because the choices are the
 * decorators someone has actually configured. A decorator this build knows but no instance of is
 * offered disabled instead of left out: the difference between "there is no such thing" and
 * "it is not set up yet" is exactly what an admin panel is for.
 * A source that can list what it monitors gets a selector of its own per instance, holding that
 * instance's targets: two Kumas watch different things, so one dropdown for the pair would offer
 * names half of it has never heard of.
 * @returns {Promise<ReadonlyArray<ApiFieldSpec>>} - The select, then the selectors
 */
export async function healthFields(): Promise<ReadonlyArray<ApiFieldSpec>> {
  const options: ApiFieldOption[] = [
    { value: '', label: 'off' },
    { value: HTTP_PROVIDER, label: 'HTTP probe' },
  ]

  const selectors: ApiFieldSpec[] = [
    { ...HTTP_SELECTOR_FIELD, showWhen: { key: HEALTH_KEY, value: [HTTP_PROVIDER] } },
  ]

  for (const module of listModules()) {
    if (!module.resolveHealth) {
      continue
    }

    const instances = isEnabled(module.type) ? listEnabledConnectors(module.type) : []

    if (instances.length === 0) {
      options.push({
        value: module.type,
        label: `${module.label} (not configured)`,
        disabled: true,
      })
      continue
    }

    const values = instances.map((instance) => providerValue(module.type, instance.id))

    instances.forEach((instance, index) => {
      options.push({ value: values[index] as string, label: `${module.label} · ${instance.label}` })
    })

    const field = module.healthSelectorField
    if (!field) {
      continue
    }

    const listed = await Promise.all(instances.map((instance) => targetsOf(module, instance)))

    // Instances that could not say, which keep the typed box between them
    const typed = values.filter((_value, index) => !listed[index])

    listed.forEach((targets, index) => {
      if (!targets) {
        return
      }

      selectors.push({
        ...field,
        input: 'select',
        // Required means there is no automatic fallback to offer, so the list stands alone
        options: field.required ? targets : [AUTOMATIC, ...targets],
        showWhen: { key: HEALTH_KEY, value: [values[index]] },
      })
    })

    if (typed.length > 0) {
      selectors.push({ ...field, showWhen: { key: HEALTH_KEY, value: typed } })
    }
  }

  return [
    {
      key: HEALTH_KEY,
      label: 'Liveness',
      input: 'select',
      options,
      hint: 'what the dot on this entry reports; one source per entry',
    },
    ...selectors,
  ]
}
