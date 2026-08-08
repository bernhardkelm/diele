/** Error carrying an HTTP status, which the app's error handler turns into a JSON response. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Returns whether a thrown value is sqlite refusing a duplicate. Matching the driver's message is
 * fragile, which is exactly why it lives here: swapping it for the error code is then one change
 * rather than four, and none of them can be missed.
 * @param {unknown} error - Value thrown by a write
 * @returns {boolean} - True when a UNIQUE constraint rejected it
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE')
}

/**
 * Builds a 400.
 * @param {string} message - Reason shown to the caller
 * @returns {ApiError} - Error with a 400 status
 */
export function badRequest(message: string): ApiError {
  return new ApiError(400, message)
}

/**
 * Builds a 401.
 * @param {string} message - Reason shown to the caller
 * @returns {ApiError} - Error with a 401 status
 */
export function unauthorized(message = 'authentication required'): ApiError {
  return new ApiError(401, message)
}

/**
 * Builds a 403.
 * @param {string} message - Reason shown to the caller
 * @returns {ApiError} - Error with a 403 status
 */
export function forbidden(message: string): ApiError {
  return new ApiError(403, message)
}

/**
 * Builds a 404.
 * @param {string} message - Reason shown to the caller
 * @returns {ApiError} - Error with a 404 status
 */
export function notFound(message = 'not found'): ApiError {
  return new ApiError(404, message)
}

/**
 * Builds a 409, for a request that is well formed but disagrees with what already exists.
 * @param {string} message - Reason shown to the caller
 * @returns {ApiError} - Error with a 409 status
 */
export function conflict(message: string): ApiError {
  return new ApiError(409, message)
}

/**
 * Builds a 429.
 * @param {string} message - Reason shown to the caller
 * @returns {ApiError} - Error with a 429 status
 */
export function tooManyRequests(message: string): ApiError {
  return new ApiError(429, message)
}

/**
 * Builds a 503, for a request the process cannot serve in the state it was started in.
 * @param {string} message - Reason shown to the caller
 * @returns {ApiError} - Error with a 503 status
 */
export function unavailable(message: string): ApiError {
  return new ApiError(503, message)
}
