# @diele/api

Backend for [`../web`](../web): it holds the configuration the launcher renders — cards, saved
sites, search engines, icons — and the login that guards it. See the [root README](../README.md)
for what diele is and how to start it; this file is the reference for the API.

The launcher is reachable by anyone and shows nothing until a session exists, so this process is
the only gate. There is no forward-auth middleware in front of it.

## Configuration

All of it is environment, and none of it needs touching to run diele: the defaults are committed in
[`../.env`](../.env), which lists **every** variable both halves read. Copy
[`../.env.local.example`](../.env.local.example) to `../.env.local` for your secrets and anything
that differs between machines — it lists the same variables again with their defaults, so
overriding one is uncommenting rather than looking it up.

The [root README](../README.md#docker) covers the handful a container actually needs. This is the
whole set.

| variable | does |
| --- | --- |
| `PORT` | port the API listens on, default `3000` |
| `DB_PATH` | where the SQLite file lives, default `data/diele.db`; a relative path is resolved from the repo root |
| `PUBLIC_ORIGIN` | origin the browser reaches diele on; the OIDC redirect uri is derived from it |
| `BRAND_TITLE`, `BRAND_SUBTITLE` | the wordmark and the line under it |
| `BRAND_ACCENT_LIGHT`, `BRAND_ACCENT_DARK` | the accent, one six-digit hex per theme |
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
| `VITE_API_TARGET` | **web, development only:** where the dev server proxies `/api`; a build talks to whatever origin serves it |

`AUTH_MODE` falls back to `local` — the mode that needs nothing configured and still holds the
door, since the first account is created through a setup form gated by a token printed at startup.
A misspelled value therefore lands on the safe mode rather than refusing to boot, and says so on
stderr.

### Where a value comes from

Most-specific-first, first match wins:

| | source | |
| --- | --- | --- |
| 1 | a real environment variable | what a container is given, so images ship no `.env` at all |
| 2 | `api/.env.local` · `web/.env.local` | package, untracked |
| 3 | `api/.env` · `web/.env` | package, committed — override slots, shipped fully commented out |
| 4 | `.env.local` | repo, untracked — where most overrides belong |
| 5 | `.env` | repo, committed — every variable, with its default |
| 6 | the built-in default | [`src/config.ts`](src/config.ts) |

The nearest scope wins outright and, within a scope, the untracked file beats the committed one:
the usual monorepo convention composed with the usual dotenv one. The root file is not a fallback
for leftovers — it carries the full set, and the package files exist only so one half can be
pointed somewhere the other should not follow. They ship with every line commented out, because a
live value in one would outrank the file people actually edit.

Only `VITE_`-prefixed variables are readable from browser code, which is why this package's secrets
sit in the same files without reaching the bundle.

## Auth

Three modes, chosen by `AUTH_MODE`, all ending in the same session and cookie:

- **`local`** — accounts live in this database and sign in with a password. For a deployment with
  no issuer to point at. This is the default, and an unset or misspelled variable lands here: it
  needs nothing configured and still holds the door, since the first account is created through a
  setup form gated by a token the server prints at startup. A misspelled value says so on stderr
  rather than being silently accepted.
- **`oidc`** — OpenID Connect authorization code with PKCE, via `openid-client`. Any compliant
  issuer works; nothing here knows which one. Setting it without `OIDC_ISSUER`, `OIDC_CLIENT_ID`
  and `OIDC_CLIENT_SECRET` refuses to boot rather than starting in a mode that cannot sign anyone
  in.
- **`dev`** — grants every login as a fixed local identity, so the frontend can be worked on
  without either. Never use it for anything reachable by others.

Sessions are **server-side and opaque**: a 256-bit random id in an httpOnly cookie, the row in
`sessions`. That buys revocation, which a JWT would not, and it lets the session be long without
being unrevokable. The two windows are **idle time, not lifetime** — 24 hours, or 90 days when
`remember me` was ticked — and roll forward on use, throttled to once an hour so opening tabs does
not mean writing to sqlite. An instance opened daily is therefore never asked again. The cookie
itself always carries the longer window: the row decides when the session ends, and a cookie
expiring on its own schedule would cut a live session short.

The cookie is `SameSite=Lax` rather than `Strict`, because the browser comes back from the issuer
as a top-level navigation and `Strict` would withhold the cookie on exactly that request.

`Secure` is derived rather than configured. `SESSION_COOKIE_SECURE=auto`, the default, turns it on
when `PUBLIC_ORIGIN` is https and off when it is not; `true` and `false` override that, and any
other value warns and derives anyway. The sentinel exists so the variable can sit in `.env` with a
live value like every other one, because the derivation only runs while nothing explicit is set —
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

A fresh database starts **empty**: configuration is entered through the admin view, and seeding it
here would mean an instance showing rows nobody added. Use the import to seed one from an export
instead.

Cards and saved sites share the `links` table and are told apart by `kind`. They differ only in
where they render — both are a label, a url, keywords and an icon. Search engines stay separate,
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

`connectors.user_id` is always null today. It is declared so the per-user variant — everyone seeing
the repos of their own token rather than the instance's — is a code change rather than a migration.

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
touching the default engine — the same template shape a search engine uses.

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

The feature carries a switch of its own, which is not the same as having no rows — probing costs a
request per port on every load, so an instance that is not a development machine turns it off
outright. It is **off by default**; `settings` holds the flag under `localhost.enabled`.

## Export and import

`GET /api/admin/export` returns cards, saved sites, search engines, slash commands, local ports,
icons and settings as one versioned document, for backup, for moving a configuration between
deployments, or for seeding a new one. `POST /api/admin/import` **replaces** all of it, in a single
transaction so a rejected row cannot leave half a configuration behind.

Two things the import does deliberately: it re-sanitises every icon, because the file may have been
edited or come from somewhere else and is about to be inlined; and it drops an `iconId` the file
did not carry, since losing a logo beats failing the whole import on a foreign key.

Connector credentials are **not** in the export and must stay out of it. An export is a file that
gets mailed around and committed, which is the last place a token belongs. A connector comes back
**off** for the same reason: without its credential it would only spend the next interval failing,
and entering the token is what turns it back on.

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
mounted ahead of the session gate, because the sign-in screen is that document — behind it, a
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
something it does not do. Only `entries` is built; `health`, `signals` and `search` are the seams
Uptime Kuma, Prometheus and a document store land on.

Connectors that are agreed on but not written yet are listed too, with `unavailable` set and nothing
behind them: Uptime Kuma, Prometheus, Grafana and Notion, in the order they are meant to
land. Each already declares the capabilities it will answer to, which is where the shape it is
expected to take is written down.

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

Uptime and Prometheus are `health`, not `entries`: they decorate entries someone else produced
rather than supplying any. Their binding is keyed by **ref**, so one table can bind a card, a saved
site and a connector-produced repo alike.

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
connectivity check, cheap enough to run on every write — GitLab reads each configured group's
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

A failed run backs off — `interval * 2^failures`, capped at an hour — so a revoked token costs a
couple of dozen requests a day rather than one every quarter. The error is stored with every stored
credential stripped out of it first, because a source's message tends to echo the request that
caused it.

**Entries a run no longer produced are swept, unless the run reported itself partial.** GitLab asks
per group and drops a group it cannot read, so one unreachable group must not empty the whole
section. That rule is the one worth a test: getting it wrong is silent data loss.

## Seeding

[`example-seed.json`](example-seed.json) is an importable document with three cards, two saved
sites, two engines, two commands and two local ports, all pointing at `example.com`. Import it
through the admin view to get something to develop against rather than starting from an empty
database. It turns local port probing on.

## Develop

From the repo root, `npm run dev` starts this and the web app together. To drive this package alone:

```sh
npm run dev -w @diele/api          # tsx watch, :3000
npm run type-check -w @diele/api
npm run lint -w @diele/api
npm run build -w @diele/api        # tsc to dist/
```

No configuration step: the committed repo-wide `.env` lists every variable with a working default.
Put your secrets and machine-specific values in a `../.env.local` — see
[Configuration](#configuration) above for the full set and the order they resolve in.

The web app proxies `/api` here, so the browser only ever talks to `:5173` and the session cookie is
first-party — which is why there is no CORS handling anywhere in this package.

The database is created and migrated on boot at `DB_PATH`, which defaults to `data/diele.db` at
the repo root and is gitignored along with the whole `data/` directory. Delete it to start over.

A relative `DB_PATH` is resolved from the repo root rather than the working directory, so the
file lands in one place whether npm ran from the root or from this package — the two differ, and
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
