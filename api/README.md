# @diele/api

Backend for [`../web`](../web): it holds the configuration the launcher renders - cards, saved
sites, search engines, icons - and the login that guards it. See the [root README](../README.md)
for what diele is and how to start it; this file is the reference for the API.

The launcher is reachable by anyone and shows nothing until a session exists, so this process is
the only gate. There is no forward-auth middleware in front of it.

## Configuration

All of it is environment, and none of it needs touching to run diele: the defaults are committed in
[`../.env`](../.env), which lists **every** variable both halves read. Copy
[`../.env.local.example`](../.env.local.example) to `../.env.local` for your secrets and anything
that differs between machines - it lists the same variables again with their defaults, so
overriding one is uncommenting rather than looking it up.

The [root README](../README.md#docker) covers the handful a container actually needs. This is the
whole set.

| variable | does |
| --- | --- |
| `PORT` | port the API listens on, default `3000` |
| `DB_PATH` | where the SQLite file lives, default `data/diele.db`; a relative path is resolved from the repo root |
| `PUBLIC_ORIGIN` | origin the browser reaches diele on; the OIDC redirect uri is derived from it |
| `BRAND_TITLE`, `BRAND_SUBTITLE` | the wordmark and the line under it |
| `BRAND_ACCENT_LIGHT`, `BRAND_ACCENT_DARK` | the accent, one six-digit hex per theme; `src/favicon/` draws the icon set from the dark one at boot and serves it ahead of the stock copy in the build |
| `AUTH_MODE` | `local` (default), `oidc` or `dev` |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | required when `AUTH_MODE=oidc` |
| `OIDC_SCOPES`, `OIDC_DISPLAY_NAME` | scopes requested, and what the sign-in button says |
| `LOCAL_SETUP_TOKEN` | local mode: gates creating the first account; generated and printed when unset |
| `DIELE_SECRET_KEYS` | `id:base64` pairs sealing connector credentials, first one active |
| `SESSION_MAX_AGE_MS`, `SESSION_REMEMBER_MAX_AGE_MS` | idle windows, not lifetimes; they roll forward on use |
| `SESSION_COOKIE_SECURE` | `auto` (default) derives it from the `PUBLIC_ORIGIN` scheme, which is almost always right; `true` or `false` override |
| `SESSION_COOKIE_NAME` | name of the session cookie, default `diele_session`; only worth changing to run two instances on one host |
| `TRUST_PROXY` | off by default; set to the number of proxies in front (`1` behind nginx) so `req.ip` is the caller and not a header |
| `DIELE_VERSION` | what `/status` reports as the running build; the image stamps it from the git tag it was built at |
| `DIELE_SEED_STOCK_CONFIG` | whether a database created by this boot gets the stock engines, commands and ports, default `true`; read only while the schema is created |
| `HISTORY_DB_PATH` | where visited history lives, default `<DB_PATH stem>-history.db` beside `DB_PATH`; a relative path is resolved from the repo root |
| `HISTORY_SERVED` | entries `GET /api/history` serves, most frecent first, default `300` |
| `HISTORY_MAX_ENTRIES` | entries kept per account, least recently visited pruned first, default `5000` |
| `HISTORY_ONE_OFF_DAYS` | days an entry visited only once survives the prune, default `14` |
| `HISTORY_PROBE` | default `true`; `false` stores a public Go to url without requesting it from this server, for deployments that do not want the server's IP sent to every site their people open. Private and local addresses are never requested either way |
| `VITE_API_TARGET` | **web, development only:** where the dev server proxies `/api`; a build talks to whatever origin serves it |

`AUTH_MODE` falls back to `local` - the mode that needs nothing configured and still holds the
door, since the first account is created through a setup form gated by a token printed at startup.
A misspelled value therefore lands on the safe mode rather than refusing to boot, and says so on
stderr.

### Where a value comes from

Most-specific-first, first match wins:

| | source | |
| --- | --- | --- |
| 1 | a real environment variable | what a container is given, so images ship no `.env` at all |
| 2 | `api/.env.local` · `web/.env.local` | package, untracked |
| 3 | `api/.env` · `web/.env` | package, committed - override slots, shipped fully commented out |
| 4 | `.env.local` | repo, untracked - where most overrides belong |
| 5 | `.env` | repo, committed - every variable, with its default |
| 6 | the built-in default | [`src/config.ts`](src/config.ts) |

The nearest scope wins outright and, within a scope, the untracked file beats the committed one:
the usual monorepo convention composed with the usual dotenv one. The root file is not a fallback
for leftovers - it carries the full set, and the package files exist only so one half can be
pointed somewhere the other should not follow. They ship with every line commented out, because a
live value in one would outrank the file people actually edit.

Only `VITE_`-prefixed variables are readable from browser code, which is why this package's secrets
sit in the same files without reaching the bundle.

## Auth

Three modes, chosen by `AUTH_MODE`, all ending in the same session and cookie:

- **`local`** - accounts live in this database and sign in with a password. For a deployment with
  no issuer to point at. This is the default, and an unset or misspelled variable lands here: it
  needs nothing configured and still holds the door, since the first account is created through a
  setup form gated by a token the server prints at startup. A misspelled value says so on stderr
  rather than being silently accepted.
- **`oidc`** - OpenID Connect authorization code with PKCE, via `openid-client`. Any compliant
  issuer works; nothing here knows which one. Setting it without `OIDC_ISSUER`, `OIDC_CLIENT_ID`
  and `OIDC_CLIENT_SECRET` refuses to boot rather than starting in a mode that cannot sign anyone
  in.
- **`dev`** - grants every login as a fixed local identity, so the frontend can be worked on
  without either. Never use it for anything reachable by others.

Sessions are **server-side and opaque**: a 256-bit random id in an httpOnly cookie, the row in
`sessions`. That buys revocation, which a JWT would not, and it lets the session be long without
being unrevokable. The two windows are **idle time, not lifetime** - 24 hours, or 90 days when
`remember me` was ticked - and roll forward on use, throttled to once an hour so opening tabs does
not mean writing to sqlite. An instance opened daily is therefore never asked again. The cookie
itself always carries the longer window: the row decides when the session ends, and a cookie
expiring on its own schedule would cut a live session short.

The cookie is `SameSite=Lax` rather than `Strict`, because the browser comes back from the issuer
as a top-level navigation and `Strict` would withhold the cookie on exactly that request.

`Secure` is derived rather than configured. `SESSION_COOKIE_SECURE=auto`, the default, turns it on
when `PUBLIC_ORIGIN` is https and off when it is not; `true` and `false` override that, and any
other value warns and derives anyway. The sentinel exists so the variable can sit in `.env` with a
live value like every other one, because the derivation only runs while nothing explicit is set -
a literal default would replace it, and a literal `false` would hold the cookie insecure on an
https origin without saying so. The reverse is just as quiet: a secure cookie sent to an http
origin is dropped by the browser without a word, so the login answers 200 and the next request is
anonymous.

Five things are load-bearing and easy to undo by accident:

- **Deny by default.** `requireSession` is mounted before every router, and the public paths are
  listed one by one in `auth/middleware.ts`. Not by prefix: `/api/auth/*` used to be public
  wholesale, which quietly made every route later added to that router public too.
- **`redirect` is validated as a relative path.** It arrives on a public endpoint, so an absolute
  value would make login an open redirect. `//evil.com` and `/\evil.com` leave the origin despite
  the leading slash, and are rejected too.
- **The callback url is built from `PUBLIC_ORIGIN`,** not from request headers, which a proxy in
  front of this process would otherwise get to decide.
- **A failed login is recorded before the password is checked,** not after. Deriving a hash takes
  long enough that a burst would otherwise all read a count of zero and all pass.
- **`X-Forwarded-For` is not trusted unless `TRUST_PROXY` says so.** `req.ip` is the only key the
  login limiter has besides the username, so a process reachable without a proxy in front would
  let a caller write that header per request and rotate past both caps. Set `TRUST_PROXY=1` when
  nginx is in front and strips it; leave it off otherwise. It also takes `true`, a subnet, or one
  of express's names like `loopback`.

### Local accounts

A local user is a row in `users` with `issuer = 'local'` and the username as `subject`, so the
existing `UNIQUE (issuer, subject)` is what keeps usernames unique. Passwords are hashed with
**argon2id** from `node:crypto` at OWASP's parameters, and the stored string carries its own
algorithm and cost, so raising them later is a rehash on next login rather than a migration.

On first boot the login screen becomes a setup screen. It is gated on a **setup token**, because
creating the first account is the one privileged action there is nobody to authenticate for, and
the server answers the internet before anyone has claimed it. Set `LOCAL_SETUP_TOKEN`, or leave it
unset and the server generates one and prints it at startup.

Failed sign-ins are counted per username *and* address together, never per username alone: an
instance in local mode usually has one account, and blocking that username outright would let
anyone lock out the only operator with ten cheap requests. An address is separately capped across
every name it tries.

`canAdmin` reads `users.is_admin`, which is set for the first account and every later issuer login.
To recover an account locked out of the panel:

```sh
sqlite3 diele.db "UPDATE users SET is_admin = 1 WHERE subject = 'you'"
```

### Setting up an OIDC provider

Register diele as a confidential client and hand it three values: `OIDC_ISSUER`,
`OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.

- **`OIDC_ISSUER`** is the application's base url, the one whose
  `.well-known/openid-configuration` answers. Everything else is discovered from it, so no other
  endpoint is configured here.
- **The redirect uri** is `PUBLIC_ORIGIN` + `/api/auth/callback`, derived rather than configured so
  a proxy cannot decide it. Register both the production one and
  `http://localhost:5173/api/auth/callback` on the same client, and one provider serves local
  development and the deployment.
- **The post-logout redirect uri** is `PUBLIC_ORIGIN` itself. Register it as well, or the issuer
  drops the return address and signing out leaves the browser on the issuer's page instead of back
  at diele's login screen. The id token the session was opened with is sent along as
  `id_token_hint`, which is what most issuers want before they skip their own confirmation page.
- **Grant types** must include `authorization_code`. Some providers create a client with none
  enabled and then reject the flow with a bare "invalid grant_type", which is a confusing way to
  find out.
- **Scopes** default to `openid email profile`. `OIDC_SCOPES` widens them; the `groups` claim is
  carried onto the session if the issuer sends one, ready for role-based permissions later.

`OIDC_DISPLAY_NAME` is what the sign-in button offers to sign in with, defaulting to `SSO`. It is
the only mode that names anything: local mode shows a form, and dev mode signs in as itself.

## Data

sqlite, through `better-sqlite3`, in WAL mode. The data is configuration: a few hundred rows, read
on every new tab and written when something is edited. A second process to run would buy nothing.

Migrations are an ordered array in `src/db/migrations/`, applied in one transaction each, with
`PRAGMA user_version` as the ledger.

A fresh database starts with the **stock configuration**: the search engines, slash commands and
local ports in [`src/db/stockConfig.ts`](src/db/stockConfig.ts), written by `seedStockConfig` at
the end of the first migration. That migration is the only place carrying the guarantee the seed
needs, that there was no database a moment ago; a later one would run on every install and put
back rows someone had deliberately deleted. `DIELE_SEED_STOCK_CONFIG=false` skips it.

Cards and saved sites are deliberately not seeded. Those are guesses at addresses only one
deployment knows, and an instance showing rows nobody added is the thing this rule exists to
prevent. Import an export, or [`example-seed.json`](example-seed.json), to get those.

Cards and saved sites share the `links` table and are told apart by `kind`. They differ only in
where they render - both are a label, a url, keywords and an icon. Search engines stay separate,
because a `{query}` template is a different thing from a destination.

`position` is spaced in tens, so moving a row between two others is one update rather than a
renumber.

Connectors add four tables. `connectors` holds the instances, `connector_secrets` their sealed
credentials, `connector_sync` what each run did and when the next is due, and `connector_entries`
what they produced.

That last one is a cache and is deliberately **persisted rather than held in memory**: the process
restarts on every deploy and every drain, and an instance whose repo list is empty until the forge
answers is the failure the whole arrangement exists to avoid. It is also what a synced document
index will be, and an index that dies on restart is not one.

`connectors.type` carries no `CHECK`: renaming one in sqlite means rebuilding the table, and adding
a connector must never cost that. `src/connectors/registry.ts` is the allowlist.

`connectors.user_id` is always null today. It is declared so the per-user variant - everyone seeing
the repos of their own token rather than the instance's - is a code change rather than a migration.

### Visited history

History is kept in a **second SQLite file**, `HISTORY_DB_PATH`, with its own connection and its own
migrations in [`src/history/migrations/`](src/history/migrations/). It is the one thing here that
is not configuration: a backup, an exclusion or a wipe can treat it on its own, the export does not
carry it and an import does not touch it. The file is created, mode `0600`, by the first
`PUT /api/history/preferences`, whichever account sends it and whatever the switches say, since an
account may opt out or exclude a domain before an admin turns anything on. Nothing else creates it:
every read, and every delete on an instance without the file, leaves the disk alone. The connection
runs with `secure_delete`, and both a delete an account asks for and a prune that removed anything
checkpoint the log with `TRUNCATE`, so forgotten rows leave the `-wal` too. Boot refuses a
`HISTORY_DB_PATH` that is the same file as `DB_PATH`: both ledgers are `user_version`. Every
`/api/history` response is `Cache-Control: no-store`.

Rows are filed under `users.history_key`, a random 128-bit key created the first time an account
sets its preferences, never under `users.id`. The history file can outlive a reset or a restore of
the configuration, and an id handed out again would otherwise give a new account someone else's
history. Foreign keys cannot cross files, so the prune deletes every owner whose key no account
holds; with no account deletion in the code today, that sweep is what covers it. It is skipped, with
one log line that names nobody, when the file holds rows and no account holds any of their keys:
that is what a main database restored from before history, or a wrong `DB_PATH`, looks like, and
sweeping then would delete everyone's history. The state served to the portal and the extension
carries `account`, a 22-character sha256 digest of a fixed label and the key, so a source can tell
whose history it buffered without ever seeing the key or the user id. Entry ids are random positive
integers below 2^53, so an id says nothing about how many entries the instance has created.

Three switches gate it, all off by default: `history` for the instance, and `historyDiele` and
`historyExtension` beneath it for each source, on only while `history` is too. Each account opts in
for itself on top. `history` off stops recording and serving; a source switch off stops
**recording** from that source and nothing else. None of them deletes anything, and neither does
an account opting out: while `history` is off, and for every account that opted out, the prune only
sweeps the rows of owners no account holds any more, and leaves the one-off expiry and the caps
alone. A write re-checks every gate, the account's exclusions and whether it deleted anything since
the batch arrived, so a probe that finishes late cannot write back what was just switched off or
forgotten.

The server decides what is kept, in [`src/history/filters.ts`](src/history/filters.ts). A url is
stored as origin and path only: no credentials, query, fragment or matrix parameters
(`;jsessionid=`, written out or encoded as `%3B`), the host lowercased without a trailing dot, a
default port dropped, and empty segments dropped, the trailing slash with them. A visit is dropped
entirely when it:

- is not http(s), or is longer than 2000 characters;
- is diele's own origin, or names, by name or as an ip literal, a loopback, link-local, metadata or
  other special-purpose host; nothing here is resolved;
- is a search results page: an engine or slash command configured here, with the term in a
  parameter or in the path, on the template's host with or without `www.` or below it, or the
  built-in list, Google Maps included. A template with the term straight after the root, such as
  `https://github.com/{query}`, matches a url with exactly one path segment on that host, with or
  without `www.`, and no subdomain;
- carries a token-like path segment, long, random and not word-like (UUIDs and 32-hex page ids
  pass);
- is a capability link: a segment holding a word such as `reset`, `password`, `invite`, `join`,
  `login`, `email`, `share` or `token`, directly followed by an opaque id, page ids included, an
  encoded `/` counting as a boundary. Only that next segment is judged, a one-letter keyword (`s`)
  counts only as a whole segment, and a slug (words joined by `-`, `_` or `.`, camelCase words
  included) is never an id, so `/auth-service/blob/main/...` and `/auth/oauth2-setup-guide` are kept;
- falls on a domain the account excluded.

Segments are percent-decoded twice before they are judged. The same rules, run without DNS, are
pinned case by case in [`tests/history/fixtures/filterCases.json`](tests/history/fixtures/filterCases.json),
which the extension's port of these filters is tested against as well. A url that arrives with
three distinct titles depends on its query string, and is folded into its origin-only entry for
good; only digests of those titles are kept. Deleting the origin entry forgets the shells folded
into it, in the same transaction. A title from the portal itself is ignored, since it only ever
echoes one this server served. Titles lose their control and format characters and are capped at
300 characters. A title is dropped, and the visit kept, when it starts with a scheme, repeats the
host, or contains, as whole words, a query value or fragment piece of three or more characters from
the url as reported, since a site's own search page is titled with the term; whole words means
bounded on both sides by the start or end of the title or by anything but a letter or a digit, so
`?tab=all` leaves `Install` alone. A reported visit time is held to the last thirty days. With both
sources on, a Go to is reported by the portal and by the extension; a visit to a url the **other**
source recorded within 60 seconds of it does not count again, though a title the extension brings
is still taken, and each visit pairs once. Each account keeps at most `HISTORY_MAX_ENTRIES` entries
and a fifth of that in folded shells, oldest first, held once for every batch written as well as in
the prune.

A visit from the portal's own bar that the account does not hold yet, and that the name checks
above kept, is **probed only when its host resolves to public addresses alone** and the account
has probes left: requested once, HEAD then GET on 405 or 501, never following a redirect, and kept
on any answer but 404 or 410. Everything else is **kept unprobed**: a private, unique-local or
CGNAT address, a name that resolves to loopback, link-local or a reserved range, one that does not
resolve or not within three seconds, and any visit past the resolve or probe budget or a full
queue. Whether an entry appears thus says nothing about which names the server's DNS can resolve,
and the one-off prune clears a typo. An ip literal is judged as written, without a lookup.

Names are resolved with c-ares (`dns.promises.Resolver`, A and AAAA, a short timeout and two
tries), which asks the nameservers over its own sockets and holds none of libuv's four threads, so
a stalled nameserver cannot starve sign-in hashing or the file system. It reads the nameservers,
not the hosts file. The probe is pinned to the vetted address: its `lookup` hands that address
back without resolving again, while the `Host` header and the TLS server name stay the hostname,
so virtual hosting and certificates work and DNS rebinding has no second answer to use. Nothing in
the probe path calls `getaddrinfo`. Only the stored form is sent. Lookups are budgeted at sixty per
account and six hundred across the instance per ten minutes, so many accounts together cannot use
the resolver as a scanner, and run four at a time with a three-second wait that counts from when
the lookup was queued. Probes are budgeted at thirty per account per ten minutes and run two at a
time. Both queues are bounded and drop rather than grow, an account may have two batches in
flight, and nothing about any of it is logged. `HISTORY_PROBE=false` keeps public urls unprobed.
Everything here is per account: what another account holds never spares a probe or counts towards
a fold. The extension's visits are not resolved or probed, and are budgeted at 2000 per account per
ten minutes; a batch past it is refused whole with a 429, which the extension keeps and sends again.

`GET /api/history` ranks by visit count weighted by Firefox-style recency buckets, less the cards,
saved sites and connector rows the portal serves under its current switches. The prune runs in the
fifteen-minute cycle beside the session sweep.

## Icons

Uploaded svgs live in the `icons` table as text. Only svg is accepted, so there is nothing to store
that a column cannot hold and no object storage to run alongside the database.

They are **sanitised on the way in, never on the way out**, so what is stored is already safe to
inline and no later reader can forget to clean it. The sanitiser is an allowlist of elements and
attributes rather than a denylist: an icon is inlined into diele's own page, so anything executable
that survives runs in diele's origin, and only enumerating what is safe stays correct as svg grows
new features. Scripts, event handlers, `foreignObject`, external references, `style` blocks,
doctypes and entity declarations are all removed or rejected.

Paint is rewritten to `currentColor` so an uploaded logo behaves like the built-in ones:
monochrome at rest, brand-coloured on hover. `fill="none"` survives, because it is the difference
between an outline and a filled shape, and internal `url(#…)` gradient references survive because
recolouring them would flatten the gradient.

## Slash commands

A keyword plus a query url carrying `{query}`, so `/yt cats` reaches youtube without the term ever
touching the default engine - the same template shape a search engine uses.

`/admin`, `/settings` and `/logout` are **not rows**: they act on the page rather than search and
nothing about them is configurable. The admin list still shows them, marked read-only, so both
kinds are visible in one place and a keyword collision is obvious. Storing one is refused outright,
so a command cannot shadow the admin panel and leave someone unable to reach it.

A keyword may not contain a slash, which is what keeps `/r/vuejs` a subreddit jump rather than a
command called `r/vuejs`.

## Local ports

Dev servers on the machine running the browser are their own feature rather than saved sites: only
the scheme and the port are editable, the url follows from them, and the frontend **probes** each
one on load and whenever the tab regains focus. Optional tags say what runs there, so `vue` finds
5173 rather than only the number doing.

The feature carries a switch of its own, which is not the same as having no rows - probing costs a
request per port on every load, so an instance that is not a development machine turns it off
outright. It is **off by default**; `settings` holds the flag under `localhost.enabled`.

This is the one probe that stays in the browser, and it has to: the machine holding the browser is
the only one that can see these ports. It is also why it reports only what answered and never marks
anything down - a cross-origin `no-cors` request comes back opaque, so reaching the port at all is
the entire question it can ask. Everything else the portal probes runs server-side, where the
status code is readable; see [Liveness](#liveness).

## Content Security Policy

The document is served under a policy that denies by default and allows each kind of resource
from this origin only, built once at boot by [`src/site/contentSecurityPolicy.ts`](src/site/contentSecurityPolicy.ts).
diele holds a person's visited history in the page while it is open, so a script that got in
through an icon would otherwise reach all of it.

| directive | allows | because |
| --- | --- | --- |
| `default-src` | `'none'` | anything not listed below is a decision nobody has made yet |
| `script-src` | `'self'`, one `'sha256-…'` | the hashed bundle, and the inline script in `web/index.html` that pins the theme and catches early keystrokes; the hash is taken from the document as served, after the brand is stamped in, so editing that script moves it |
| `style-src` | `'self'` | the extracted stylesheet; Vue writes `:style` bindings through the CSSOM, which no directive governs, and the icon sanitiser strips `style` attributes, so nothing needs `'unsafe-inline'` |
| `img-src`, `font-src`, `manifest-src` | `'self'` | the favicons, the self-hosted woff2 files under `/assets`, and `site.webmanifest`; uploaded icons are inline svg, not images |
| `connect-src` | `'self'`; `http(s)://localhost:*` and `http(s)://127.0.0.1:*` only while something is probed | the api, and the [local ports](#local-ports) probe, the one request the browser makes anywhere else. The loopback sources are added per request, only while local ports are on with a port saved or a saved site points at loopback, so the default portal cannot reach this machine at all. Any port rather than the saved ones, because the document is served ahead of the session gate and would publish them, and a port added in the admin panel would stay blocked until a reload; a switch flipped there likewise takes effect on the next load. `[::1]` cannot be named in a policy, so a probe there reads as nothing answering |
| `object-src`, `base-uri`, `frame-ancestors` | `'none'` | no plugins, no `<base>` to repoint relative urls, and no page may frame diele |
| `form-action` | `'self'` | every form submits through `fetch`; this keeps an injected one from posting anywhere else |
| `require-trusted-types-for`, `trusted-types` (report-only) | `'script'`; `diele-svg vue` | the one way markup reaches `innerHTML` is `v-svg` ([`web/src/directives/trustedSvg.ts`](../web/src/directives/trustedSvg.ts)) and its `diele-svg` policy; `vue` is the policy Vue's runtime creates for compiled templates and `v-html`, which lint keeps out of the app because it passes any string |

Search, launch, links and the OIDC redirect are navigations, which a policy does not restrict.
Every other response, the api's json, the favicons and the assets, carries
`default-src 'none'; frame-ancestors 'none'`: none of them is meant to render as a page. Every
response, the document included, carries `X-Content-Type-Options: nosniff`, since `script-src
'self'` trusts that nothing else on this origin is ever run as a script on a guessed type, and
`Referrer-Policy: same-origin`, so a link out of the portal tells the site it leads to nothing
about which instance it was opened from.

The policy is served ahead of the session gate, so the login page's `connect-src` tells an
anonymous visitor whether local-port probing is configured: the loopback sources are there or not.
That one bit is accepted; which ports, and which sites, it never says.

The Trusted Types row is sent as `Content-Security-Policy-Report-Only` beside the enforced policy,
so a violation shows in the console without breaking the page. It moves into the enforced header
once a release has run without a report.

Not enforced by the vite dev server, which serves `index.html` itself and injects its own client
and `<style>` elements. `npm run build` and the api on `:3000` serve the real policy.

**Adding an external resource** - a font from a CDN, an avatar from GitLab, a browser-side fetch to
another host - means adding that origin, and nothing wider, to the matching directive in
`documentPolicy`, a row here, and the expectation in
[`tests/site/contentSecurityPolicy.test.ts`](tests/site/contentSecurityPolicy.test.ts), which fails
on any source it does not list. A new inline `<script>` or `<style>` in `web/index.html` needs
nothing: it is hashed at boot like the existing one.

## Export and import

`GET /api/admin/export` returns cards, saved sites, search engines, slash commands, local ports,
icons, connectors, liveness bindings and settings as one versioned document, for backup, for moving
a configuration between deployments, or for seeding a new one. `POST /api/admin/import`
**replaces** all of it, in a single transaction so a rejected row cannot leave half a configuration
behind.

Three things the import does deliberately: it re-sanitises every icon, because the file may have
been edited or come from somewhere else and is about to be inlined; it drops an `iconId` the file
did not carry, since losing a logo beats failing the whole import on a foreign key; and it drops a
liveness binding whose target the file did not carry, since a ref is not a foreign key and nothing
would otherwise catch it.

**Row ids travel and are restored as they were.** Cards, saved sites and connectors keep their ids,
the way icons always have, because a ref is built from an id and the liveness bindings are keyed by
ref. Renumbering on arrival would restore a portal whose dots point at whichever card happened to
land on that number. A file from before this carried no ids and is numbered on the way in, which is
safe because it carries no bindings either.

Connector credentials **do** travel, still sealed under the key that wrote them, never in the
clear. What opens them is `DIELE_SECRET_KEYS`, which belongs to the deployment rather than to the
file: an instance holding the same key restores a working connector, and one holding a different
key finds nothing it can open. A connector whose credentials did not open comes back **off**,
because without them it would only spend the next interval failing, and entering the token is what
turns it back on.

## Endpoints

| method | path | |
| --- | --- | --- |
| `GET` | `/status` | health and the running build, public |
| `GET` | `/api/auth/providers` | what the login screen offers, and whether setup is pending; public |
| `GET` | `/api/auth/login` | 302 to the issuer, `?redirect=` to come back to, `?remember=1` for the long window |
| `POST` | `/api/auth/login` | local mode: username and password, opens a session |
| `POST` | `/api/auth/setup` | local mode: creates the first account, needs the setup token |
| `GET` | `/api/auth/callback` | exchange, open session, 302 back |
| `POST` | `/api/auth/logout` | end session, answer with the issuer's logout url |
| `GET` | `/api/auth/me` | current user, or 401 |
| `GET` | `/api/config` | brand, cards, sites, engines and settings in one payload |
| `GET` | `/api/entries` | what the connectors produced, one line per source saying when it last synced, and what is hidden |
| `PUT` | `/api/entries/hidden` | hide an entry or bring it back, for yourself or for everyone |
| `GET` | `/api/health` | how each bound entry last answered, and when to ask again |
| `GET` | `/api/history` | the account's history state, and its most frecent entries less what the portal already offers |
| `GET` | `/api/history/state` | the history state alone, without ranking anything: the switches, the opt-in, the excluded domains, how many entries are kept and the opaque `account` tag; what the extension reads on every load of the portal |
| `GET` | `/api/history/entries` | every entry the account holds, most recent first, whatever the switches say |
| `POST` | `/api/history/visits` | report visits from a source, up to 20 from `diele` and 200 from `extension`; answered at once, checked and written in the background; 403 while the feature, the source or the account's opt-in is off, 429 while the account already has two batches in flight or, from `extension`, the batch would take it past 2000 visits in ten minutes |
| `DELETE` | `/api/history/entries/:id` | forget one entry, an origin entry with the shells folded into it; 404 alike for one that is missing and one that is not yours |
| `DELETE` | `/api/history/entries` | forget them all; the preferences stay |
| `PUT` | `/api/history/preferences` | opt in or out, set the excluded domains; adding one forgets what was kept on it; creates the history file on first use, whatever the switches say |
| `GET` | `/api/admin/features` | the registry the admin view renders from |
| `GET`&nbsp;`POST` | `/api/admin/links/:kind` | list and create cards (`card`) or saved sites (`site`) |
| `PATCH`&nbsp;`DELETE` | `/api/admin/links/:kind/:id` | edit and remove one |
| `PUT` | `/api/admin/links/:kind/:id/enabled` | turn one on or off without deleting it |
| `PUT` | `/api/admin/links/:kind/order` | rewrite the section's order |
| `GET`&nbsp;`POST` | `/api/admin/engines` | list and create search engines |
| `PATCH`&nbsp;`DELETE` | `/api/admin/engines/:id` | edit and remove one |
| `PUT` | `/api/admin/engines/:id/enabled` | turn one on or off |
| `PUT` | `/api/admin/engines/order` | rewrite the order; the first engine is the default |
| `GET`&nbsp;`POST` | `/api/admin/commands` | list and create slash commands |
| `PATCH`&nbsp;`DELETE` | `/api/admin/commands/:id` | edit and remove one |
| `PUT` | `/api/admin/commands/:id/enabled` | turn one on or off |
| `PUT` | `/api/admin/commands/order` | rewrite the order |
| `GET`&nbsp;`POST` | `/api/admin/localhost` | list and create local ports |
| `PATCH`&nbsp;`DELETE` | `/api/admin/localhost/:id` | edit and remove one |
| `PUT` | `/api/admin/localhost/:id/enabled` | turn one on or off |
| `PUT` | `/api/admin/localhost/order` | rewrite the order |
| `PUT` | `/api/admin/features/:id/enabled` | turn a whole feature on or off |
| `GET`&nbsp;`POST` | `/api/admin/connectors/:type` | list and create instances of one connector |
| `PATCH`&nbsp;`DELETE` | `/api/admin/connectors/:type/:id` | edit and remove one |
| `PUT` | `/api/admin/connectors/:type/:id/enabled` | turn one on or off |
| `PUT` | `/api/admin/connectors/:type/order` | rewrite the order |
| `POST` | `/api/admin/connectors/:type/:id/sync` | refresh now, rather than waiting out the interval |
| `GET`&nbsp;`POST` | `/api/admin/icons` | list and upload icons; upload sanitises before storing |
| `DELETE` | `/api/admin/icons/:id` | remove one; cards referencing it lose the logo, not the card |
| `GET` | `/api/admin/export` | the whole configuration as one portable document |
| `POST` | `/api/admin/import` | replace the whole configuration with one |

Every feature that owns rows answers `{ rows: [...] }`, and its url arrives on the feature as
`collection`, so the client reads one key whatever it opened and a new connector needs no case of
its own there.

`/api/config` is one request by design: diele is a new tab page, so a second round trip is a second
chance to be slow. Express' own etag turns an unchanged payload into a 304. `/api/entries` is
separate for exactly that reason: config changes only when a human edits it, and folding entries in
would bust its etag on every sync and resend the inline icons with it.

Everything under `/api/admin` additionally passes `requireAdmin`. The client's mode switch is a
convenience, never the gate.

Everything that is not one of these paths is the launcher: `src/site/routes.ts` serves `web/dist`
when that directory holds a build, and answers an unrecognised path with `index.html`. It is
mounted ahead of the session gate, because the sign-in screen is that document - behind it, a
portal could never be signed in to. It hands `/api` and `/status` straight back, so an api path
nothing claims is still a json 404 rather than a page.

## Connectors

A connector is a feature whose rows come from somewhere else, and `GET /api/admin/features`
describes both kinds in one shape. A connector **type** is the feature; its **instances** are the
rows, so two GitLab instances are two rows under one heading.

Each module declares:

- **`fields`**, each with an `input` mode (`text`, `url`, `template`, `secret`, `icon`, `color`,
  `toggle`, `number`, `select`, `keywords`). The client renders the form from these, so a new
  connector needs no form code. A field left blank is not stored as empty: it is dropped, so
  whatever the module declares as that field's default is what applies. A text box advertises its
  default with a `placeholder`; a checkbox has nowhere to say one, so it carries `default` and the
  blank form starts ticked.
- **`produces`**, a list of display modes (`card`, `row`, `suggestion`, `engine`, `inline`). The
  launcher already knows how to draw each, so a connector needs no render code either.

### Capabilities

`produces` says where output lands on the page. **Capabilities** say who calls the connector and on
what clock, which is a different question and the one the runtime cares about:

| capability | called by | cadence | a failure means |
| --- | --- | --- | --- |
| `entries` | this process' scheduler | minutes | the list goes stale, the old rows stand |
| `health` | client poll, fanned out here | ~60s | no dot, never a red one |
| `signals` | client poll, fanned out here | ~30s | no banner |
| `search` | a keystroke | per query | nothing, silently |

They are **read off the methods a module implements** rather than declared, so a module cannot claim
something it does not do. `entries` and `health` are built; `signals` and `search` are the seams a
banner and a document store land on.

Connectors that are agreed on but not written yet are listed too, with `unavailable` set and nothing
behind them: Grafana and Notion, in the order they are meant to land. Each already declares the
capabilities it will answer to, which is where the shape it is expected to take is written down.

`unavailable` carries the sentence; `unavailableReason` says which of two things it is, so the
panel can label the row without reading the sentence:

| reason | means | badge |
| --- | --- | --- |
| `planned` | no code behind it yet | `soon` |
| `blocked` | built and working, but something outside it is unconfigured | `blocked` |

The distinction matters because they read the same from a distance and are not the same problem.
A connector with no usable encryption key is `blocked`, not `planned`: nothing is coming, the
deployment is missing `DIELE_SECRET_KEYS`, and calling that "soon" tells someone to wait for
what is already there.

### Liveness

Uptime Kuma and Prometheus are `health`, not `entries`: they **decorate** entries someone else
produced rather than supplying any. `produces` is empty, `collect` is absent, and both fall out of
the sync scheduler and the row editor without either having to know about them.

`health_bindings` is keyed by **ref** and its primary key is that ref alone, so one table binds a
card, a saved site and a connector-produced repo, and every entry has exactly one source. The
built-in HTTP probe sits in the same table under the provider `http`, with no connector behind it
at all - it needs no source, no credential and no row.

What identifies a target belongs to whatever resolves it, so a module declares its own
`healthSelectorField` and the card editor renders it. The dropdown's options are built per request
from the decorators that actually have an enabled instance, and each selector field carries a
`showWhen` naming the options it applies to. A decorator this build registers but no instance of
is offered **disabled**: "there is no such thing" and "it is not set up yet" are different answers.

Resolution runs on read with a per-provider TTL, single-flighted and stale-while-revalidate, so N
tabs and M people are one request upstream and nobody ever waits on a source. Readings live in
memory and are **never persisted** - the opposite call from entries, and deliberately. A repo list
a quarter of an hour old beats an empty section; an `up` a quarter of an hour old is not old, it
is wrong. Anything past 3× its own interval is dropped rather than served.

A source that fails yields no readings rather than a map of `down`: a decorator that cannot be
reached knows nothing about the services it watches. `detail` is admin-only for the same reason a
sync error is narrowed - a monitor name or a label set says which internal hosts exist and how
they answer.

### Refs

Every launcher target carries a stable id: `card:12`, `site:4`, `port:7`, `cmd:3`,
`gitlab:2:repo:1449`. The client keys its render, its launch history and its status map on these
and derives none of them. The grammar lives in `src/connectors/refs.ts`; the client only ever
compares refs, never parses them.

A connector ref uses the source's own numeric id rather than a path, so renaming a repo does not
throw away everything diele had learned about it.

### Secrets

A `secret` field is write-only: never returned, and the editor shows whether one is set rather than
its value. An empty box on an edit therefore means *leave it alone*, not *clear it*.

Credentials are sealed with AES-256-GCM before they are stored. `DIELE_SECRET_KEYS` holds a comma
separated list of `id:base64` pairs, the first being the active one, so rotating means prepending a
key and leaving the old ones behind to open what they already sealed. The connector id and the field
name are the cipher's associated data, so ciphertext copied between rows fails to open rather than
decrypting into the wrong place.

Be clear about what this buys, because it is not everything: the key is in the process' environment,
so it is no defence against someone holding the host. It protects a volume snapshot, a
`sqlite3 diele.db .dump` in the middle of debugging, and the day somebody adds a table to
`buildExport()` without thinking.

An unusable key is **not fatal**. The server boots, the login works, entries already synced are
still served, and the connector features say their credentials cannot be read. Refusing to start
would take the only gate in front of the launcher down over a connector token.

### Saving

A save is refused unless the settings actually reach the source. `verify` is a module's own
connectivity check, cheap enough to run on every write - GitLab reads each configured group's
record, which answers both questions at once: whether the token works at all, and whether it can see
that particular group. Nothing is written until it passes, so a connector cannot be stored in a
state where every run is going to fail and the first anyone hears of it is an empty list. An edit is
checked the same way, against the credentials it carries or the stored ones when the form left the
box empty.

A connector that passes is then **synced immediately** rather than on the next tick, so the row the
save answers with already reports what it found and the launcher has the entries before anyone
leaves the panel.

### Hiding

An entry can be kept out of the list for one person or for everyone, and both live in
`hidden_entries` rather than in a browser: a choice that only exists on the device that made it is
one someone loses by opening diele somewhere else, and hiding something for everyone is not a
device's business at all. A row with no `user_id` is the instance's own choice and only an admin may
make it; one with a `user_id` is that person's and says nothing about anyone else.

`/api/entries` serves every entry, hidden or not, and says which refs are hidden in which scope. The
client leaves them out. That is deliberate: hiding is a display preference rather than a permission,
and the lists that manage it have to show what is hidden in order to bring it back. Anything that
must not be seen belongs behind the connector's own token, not behind this.

### Syncing

One 30-second tick picks up whatever `connector_sync` says is due, and runs it. Serial rather than
concurrent: syncing is not urgent, and better-sqlite3 is synchronous, so several runs landing
together would each block the event loop for the length of their own write. It starts in the
`listen` callback, so a slow source cannot delay the port opening.

A failed run backs off - `interval * 2^failures`, capped at an hour - so a revoked token costs a
couple of dozen requests a day rather than one every quarter. The error is stored with every stored
credential stripped out of it first, because a source's message tends to echo the request that
caused it.

**Entries a run no longer produced are swept, unless the run reported itself partial.** GitLab asks
per group and drops a group it cannot read, so one unreachable group must not empty the whole
section. That rule is the one worth a test: getting it wrong is silent data loss.

## Seeding

A fresh database already carries the stock configuration, so this is about the rest.

[`example-seed.json`](example-seed.json) is an importable document with three cards and two saved
sites pointing at `example.com`, for something to develop against. It also carries the stock
engines, commands and ports, because an import **replaces** every table rather than adding to
them: without them the imported portal would have no engine left and `↵` would search nothing.
`tests/db/stockConfig.test.ts` fails if the two ever drift apart. It turns local port probing on.

## Develop

From the repo root, `npm run dev` starts this and the web app together. To drive this package alone:

```sh
npm run dev -w @diele/api          # tsx watch, :3000
npm run type-check -w @diele/api
npm run lint -w @diele/api
npm run build -w @diele/api        # tsc to dist/
```

No configuration step: the committed repo-wide `.env` lists every variable with a working default.
Put your secrets and machine-specific values in a `../.env.local` - see
[Configuration](#configuration) above for the full set and the order they resolve in.

The web app proxies `/api` here, so the browser only ever talks to `:5173` and the session cookie is
first-party - which is why there is no CORS handling anywhere in this package.

The database is created and migrated on boot at `DB_PATH`, which defaults to `data/diele.db` at
the repo root and is gitignored along with the whole `data/` directory. Delete it to start over.

A relative `DB_PATH` is resolved from the repo root rather than the working directory, so the
file lands in one place whether npm ran from the root or from this package - the two differ, and
a cwd-relative default would quietly give each its own database. An absolute path is used as it
stands, which is how a container points this at a mounted volume.

## Test

```sh
npm test -w @diele/api
```

`node:test` through `tsx`, against a throwaway database at `./.test.db`. Three things earn their
keep: that a sealed secret opens back and that a wrong key fails loudly rather than returning
garbage, that a partial sync leaves untouched rows standing, and that the GitLab mapper drops a
malformed entry instead of throwing on it.
