// Same-origin paths served by the portal's own nginx, which proxies them to Uptime Kuma.
// Going direct would hit the auth-gated ingress, which answers cross-origin fetches
// with a login redirect carrying no CORS headers. The status page slug lives in the nginx
// config, so it can change without rebuilding the frontend.
export const UPTIME_SUMMARY_URL = '/api/uptime/summary'
export const UPTIME_HEARTBEAT_URL = '/api/uptime/heartbeat'

// Kuma writes a heartbeat about once a minute, so polling faster only adds load.
export const UPTIME_POLL_MS = 60_000
