import type { SessionUser } from './auth/session.ts'

declare global {
  namespace Express {
    interface Request {
      /** Set by `attachSession` when the request carried a valid session cookie */
      user?: SessionUser
      /** The session id the cookie carried, kept so logout can drop exactly that row */
      sessionId?: string
    }
  }
}

export {}
