import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import { isPublicPath, requireAdmin, requireSameOrigin } from '#auth/middleware.js'
import { config } from '#config.js'
import { ApiError } from '#errors.js'
import type { SessionUser } from '#auth/session.js'

/**
 * Builds the few properties these middlewares actually read, so a test does not need a socket.
 * @param {{ method?: string; path?: string; headers?: Record<string, string>; user?: SessionUser }} parts - What the request should carry
 * @returns {Request} - Enough of a request for a middleware to run against
 */
function requestOf(parts: {
  method?: string
  path?: string
  headers?: Record<string, string>
  user?: SessionUser
}): Request {
  const headers = parts.headers ?? {}

  return {
    method: parts.method ?? 'GET',
    path: parts.path ?? '/api/config',
    user: parts.user,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request
}

/**
 * Runs a middleware and reports what it passed to `next`.
 * @param {import('express').RequestHandler} handler - Middleware under test
 * @param {Request} req - Request to run it against
 * @returns {unknown} - The value handed to `next`, or undefined when it let the request through
 */
function outcome(handler: ReturnType<typeof requireAdmin>, req: Request): unknown {
  let passed: unknown

  const next: NextFunction = (error?: unknown) => {
    passed = error
  }

  handler(req, {} as Response, next)

  return passed
}

const admin: SessionUser = {
  id: 1,
  issuer: 'local',
  subject: 'admin',
  email: null,
  name: null,
  picture: null,
  isAdmin: true,
  groups: [],
}

const viewer: SessionUser = { ...admin, id: 2, subject: 'viewer', isAdmin: false }

test('the public list is exactly the paths that answer without a session', () => {
  for (const path of [
    '/status',
    '/api/auth/providers',
    '/api/auth/login',
    '/api/auth/callback',
    '/api/auth/setup',
    '/api/auth/logout',
    '/api/auth/me',
  ]) {
    assert.equal(isPublicPath(path), true, path)
  }
})

// Listed one by one rather than by prefix, which is what keeps a route added to the auth
// router later from being public because nobody thought about it.
test('a path is not public for sharing a prefix with one that is', () => {
  for (const path of [
    '/api/auth',
    '/api/auth/sessions',
    '/api/auth/login/extra',
    '/api/config',
    '/api/admin/features',
    '/status/deep',
  ]) {
    assert.equal(isPublicPath(path), false, path)
  }
})

test('an anonymous request is refused by the admin gate before the permission is even read', () => {
  const error = outcome(requireAdmin(), requestOf({ path: '/api/admin/features' }))

  assert.ok(error instanceof ApiError)
  assert.equal(error.status, 401)
})

test('a signed-in account without the flag is refused, and one with it is let through', () => {
  const denied = outcome(requireAdmin(), requestOf({ user: viewer }))
  assert.ok(denied instanceof ApiError)
  assert.equal(denied.status, 403)

  assert.equal(outcome(requireAdmin(), requestOf({ user: admin })), undefined)
})

test('a read is never checked for origin, since it changes nothing', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    const error = outcome(
      requireSameOrigin(),
      requestOf({ method, headers: { origin: 'https://evil.example' } }),
    )

    assert.equal(error, undefined, method)
  }
})

test('a write from the portal itself is allowed', () => {
  const error = outcome(
    requireSameOrigin(),
    requestOf({ method: 'POST', headers: { origin: config.publicOrigin } }),
  )

  assert.equal(error, undefined)
})

test('a write from anywhere else is rejected', () => {
  for (const origin of [
    'https://evil.example',
    'null',
    `${config.publicOrigin}.evil.example`,
    `${config.publicOrigin}/`,
  ]) {
    const error = outcome(requireSameOrigin(), requestOf({ method: 'POST', headers: { origin } }))

    assert.ok(error instanceof ApiError, origin)
    assert.equal(error.status, 401)
  }
})

// Older clients omit Origin on same-origin writes, so Sec-Fetch-Site carries the answer when
// it is there and the absence of both cannot be a credentialed cross-site request anyway.
test('a write with no origin is judged by Sec-Fetch-Site', () => {
  assert.equal(outcome(requireSameOrigin(), requestOf({ method: 'POST' })), undefined)

  assert.equal(
    outcome(
      requireSameOrigin(),
      requestOf({ method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }),
    ),
    undefined,
  )

  for (const site of ['cross-site', 'same-site', 'none']) {
    const error = outcome(
      requireSameOrigin(),
      requestOf({ method: 'POST', headers: { 'sec-fetch-site': site } }),
    )

    assert.ok(error instanceof ApiError, site)
    assert.equal(error.status, 401)
  }
})
