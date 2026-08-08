import type { ApiBrand } from './config.js'

/**
 * `oidc` runs the real authorization code flow; `local` keeps accounts in the database and
 * signs them in with a password; `dev` mints a session for a fixed local identity so the web
 * app can be worked on without either.
 */
export type AuthMode = 'oidc' | 'dev' | 'local'

export interface ApiUser {
  readonly id: number
  readonly email: string | null
  readonly name: string | null
  readonly picture: string | null
  /** Whether the mode switch is offered; the admin routes enforce it independently */
  readonly canAdmin: boolean
}

export interface ApiProvider {
  readonly id: string
  readonly name: string
}

export interface ApiProviders {
  /** Carried here too, because the login screen is unauthenticated and cannot read /api/config */
  readonly brand: ApiBrand
  readonly mode: AuthMode
  /** True while diele holds no account yet, so the gate asks for one instead of a login */
  readonly setupRequired: boolean
  readonly providers: ReadonlyArray<ApiProvider>
}
