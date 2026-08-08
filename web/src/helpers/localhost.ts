const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Returns whether a url points at this machine, which is what makes it cheap and meaningful
 * to probe for a listening server.
 * @param {string} url - Absolute url to test
 * @returns {boolean} - True for localhost and loopback addresses
 */
export function isLocalhostUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}
