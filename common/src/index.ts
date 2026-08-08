/**
 * The wire between the api and the web app. Both sides import these rather than describing the
 * same payload twice, so a field that changes on one side stops compiling on the other instead
 * of arriving as a silently missing value.
 *
 * Types only, deliberately. Nothing here is emitted, so neither side gains a runtime
 * dependency on the other.
 *
 * This is the one barrel file in the repo: it is the package entry point, so it defines the
 * public surface rather than splitting imports of one directory across two styles.
 */

export type { ApiUser, ApiProvider, ApiProviders, AuthMode } from './auth.js'
export type {
  ApiBrand,
  ApiCommand,
  ApiConfig,
  ApiIcon,
  ApiLink,
  ApiLocalhostPort,
  ApiSearchEngine,
  LinkKind,
} from './config.js'
export type {
  ApiEntries,
  ApiEntriesSource,
  ApiEntry,
  ApiHidden,
  EntryAction,
  EntryKind,
} from './entries.js'
export type {
  ApiFeature,
  ApiFieldSpec,
  ApiRow,
  Capability,
  DisplayMode,
  InputMode,
} from './features.js'
