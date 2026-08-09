import { Buffer } from 'node:buffer'

/**
 * Builds the header Kuma's metrics endpoint authenticates with. It is HTTP Basic with an empty
 * username and the API key as the password, which is what Kuma's own docs tell a Prometheus
 * scraper to send.
 * @param {string} apiKey - API key created under Settings, API Keys
 * @returns {Record<string, string>} - Headers for fetch
 */
function headersFor(apiKey: string): Record<string, string> {
  return {
    accept: 'text/plain',
    authorization: `Basic ${Buffer.from(`:${apiKey}`, 'utf8').toString('base64')}`,
  }
}

/**
 * Reads the metrics endpoint, which carries every monitor whether or not a status page publishes
 * it. Naming the two answers worth telling apart without opening Kuma: a key that is not valid,
 * and an origin that is not a Kuma.
 * @param {string} baseUrl - Kuma origin with trailing slashes already stripped
 * @param {string} apiKey - API key created under Settings, API Keys
 * @param {AbortSignal} signal - Aborts the request when the caller runs out of time
 * @returns {Promise<string>} - Response body in the Prometheus text exposition format
 */
export async function fetchMetrics(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(`${baseUrl}/metrics`, { headers: headersFor(apiKey), signal })

  if (response.status === 401 || response.status === 403) {
    throw new Error('the API key was rejected')
  }

  if (!response.ok) {
    throw new Error(`Uptime Kuma answered ${response.status} for its metrics`)
  }

  return await response.text()
}
