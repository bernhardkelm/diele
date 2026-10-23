# Security

## Reporting a vulnerability

Report it privately through GitHub's [security advisories][advisories] rather than as an issue,
so it is not public before there is something to update to.

[advisories]: https://github.com/bernhardkelm/diele/security/advisories/new

Useful in a report: what an attacker can reach, what they end up with, and the smallest sequence
that shows it. A branch or a failing test says more than a description.

There are no releases yet and no supported versions to speak of - while that is true, `main` is
the only thing to fix.

## What diele is exposed to

An instance holds sessions and the credentials its connectors sync with, so the parts worth
looking at first are:

- **Sessions** (`api/src/auth/`) - the cookie, the server-side session rows, the sign-in rate
  limiting, and the first-account setup flow.
- **Connector credentials** (`api/src/secrets/`) - sealed with AES-256-GCM under the keys in
  `DIELE_SECRET_KEYS`. Losing that variable means re-entering every credential; leaking it means
  the database is enough to read them.
- **Untrusted markup** (`api/src/icons/sanitize.ts`) - uploaded SVGs are inlined into the
  portal's own page, so the sanitiser is the boundary.
- **Content Security Policy** (`api/src/site/contentSecurityPolicy.ts`) - the layer behind the
  sanitiser: the page runs only its own bundle and one hashed inline script, and talks only to its
  own origin and, while it probes one, the loopback ports. Trusted Types is reported, not yet
  enforced, with icon markup the only thing let into `innerHTML`. Script that runs in the page
  despite it is in scope. Every response also carries `Referrer-Policy: same-origin`, so a link out
  of the portal does not tell the site it leads to which instance it was opened from.
- **The origin** - diele must be the only app on it. Anything else served there reads the
  history with the visitor's own cookie, and the extension's relay trusts the whole origin.
- **Untrusted values from elsewhere** (`api/src/admin/importConfig.ts`,
  `api/src/connectors/entries.ts`) - an imported configuration file and a connector's own output
  are both held to the same rules as a typed one, since both end up as links on the page.

## What is out of scope

- **`AUTH_MODE=dev`** grants every login as a fixed identity. That is what it is for; it is not a
  vulnerability, and the server says so on stderr at every start.
- **A connector pointed at an internal address.** Configuring one is an admin's job, and an
  internal GitLab is a normal thing to point at. Sync errors are kept to admins for that reason -
  if you find a way for a non-admin to read them, that *is* in scope.
- **Whether local-port probing is configured.** The policy is served before sign-in, so the login
  page's `connect-src` tells an anonymous visitor whether it lists the loopback sources. That one
  bit is accepted; a way to learn which ports, or which saved sites, *is* in scope.
- **Anything requiring an operator to run a hostile configuration deliberately.** Importing a
  file from someone you do not trust replaces your whole portal by design.
