import type { Request } from 'express'
import { badRequest } from '#errors.js'

/**
 * Reads a positive integer id out of the path.
 * @param {Request} req - Request carrying the id parameter
 * @returns {number} - The parsed id
 */
export function idParam(req: Request): number {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest('id must be a positive integer')
  }

  return id
}

/**
 * Reads the boolean an enable/disable route carries.
 * @param {Request} req - Request whose body should hold `enabled`
 * @returns {boolean} - The validated flag
 */
export function enabledBody(req: Request): boolean {
  const { enabled } = req.body as { enabled?: unknown }
  if (typeof enabled !== 'boolean') {
    throw badRequest('enabled must be a boolean')
  }

  return enabled
}
