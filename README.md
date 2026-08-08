# diele

A self-hosted new tab page for everything you run.

Open a tab and the cursor is already in the search bar. Type, and diele searches your service
cards, your saved sites, your repos and your local dev servers together — by name, by url and by
keyword — then `↵` opens the best match. Nothing matches? The same `↵` searches the web.

Everything it shows is a row in its own database, edited from a panel inside the page. There are
no config files to redeploy: add a card, change the wordmark, plug in a GitLab token, and the
next tab has it.

> **Status:** used daily, but young. The endpoints and the database schema are still moving, and
> there are no releases yet. See [Not here yet](#not-here-yet) before you rely on it.

## What it does

**Search that ranks what you own over the web.** One bar over cards, saved sites, connector rows
and local ports. Fuzzy, so `prometeus` still finds Prometheus and `uk` finds Uptime Kuma. Paths
split on their separators, so `example-group/web` matches both halves. A term that is really a
url leads the results as **Go to**; one written as `r/vuejs` leads them as a jump to that
subreddit.

**A keyboard the whole way down.** `↑` `↓` move the highlight, `←` `→` step through a repo's
pipelines, merge requests and releases, `tab` cycles search engines, `alt`+`1`–`9` opens a card
by its badge, and `esc` backs out one level at a time. The admin and settings views reuse the
same ring, so nothing is reachable only by mouse.

**Slash commands.** `/` lists them. `/admin`, `/settings` and `/logout` are built in; the rest are
a keyword plus a query url carrying `{query}`, so `/yt cats` goes straight to YouTube.

**Connectors.** A connector is a feature whose rows come from somewhere else. GitLab ships today:
give it a token and some groups and your repos appear under the cards, each with its own quick
jumps. Entries are synced on a timer into diele's own store, so a restart never shows an empty
list and a revoked token leaves the last good sync standing rather than wiping it.

**Local ports.** Dev servers on the machine holding the browser are probed on load and get a dot
when something is listening, so `vue` finds `:5173` rather than only the number doing. Off by
default, because it costs a request per port on every load.

**An admin panel, not a config file.** Cards, sites, engines, commands, ports, icons and
connectors are all rows, all edited in place, all exportable as one document you can import into
another instance. Each feature declares its own fields, so a new connector needs no form code.

**Three ways to sign in.** OpenID Connect with PKCE against any issuer, local accounts with
argon2id passwords, or a `dev` mode that grants every login while you work on the frontend.
All three end in the same opaque server-side session, so signing someone out actually works.

**Light and dark**, following the OS by default, pinnable per device in `#/settings`. Uploaded
SVG logos are sanitised on the way in and recoloured to `currentColor`, so they sit monochrome
at rest and take their brand colour on hover.

## Quickstart

Needs Node 24.7 or newer. Nothing else — the database is a file.

```sh
git clone <your-fork> diele
cd diele
npm install
npm run dev
```

No configuration step: the defaults are committed, so that starts the API on `:3000` and the web
app on `:5173` and creates the SQLite database on first boot. Open **http://localhost:5173**.

The first page is a **setup screen**, because a fresh instance holds no account. Creating the
first one is gated by a token the server prints at startup — look for it in the `npm run dev`
output. After that, `admin` signs in with the password you chose.

To work on the web app without signing in at all, put `AUTH_MODE=dev` in a `.env.local`. It
grants every login as a fixed identity, so never set it on anything reachable by others.

A fresh database is **empty** on purpose: an instance showing rows nobody added would be
guessing. To get something to look at, open `#/admin` → *Import* and pick
[`api/example-seed.json`](api/example-seed.json).

### Making it your new tab page

Chrome has no setting for this — overriding the new tab page takes an extension, so there is one
in [`extension/`](extension/README.md). Load it unpacked from `chrome://extensions`, open a new
tab, and enter the address of your instance. It asks for the `storage` permission and nothing
else: no host access, no build step, no third party.

```sh
npm run build        # common types, then api, then web
npm run type-check
npm run lint
npm test
```

## Configuration

All of it is environment, and none of it needs touching to run diele: the defaults are committed
in [`.env`](.env), which lists **every** variable both halves read. Copy
[`.env.local.example`](.env.local.example) to `.env.local` for your secrets and anything that
differs between machines — it lists the same variables again with their defaults, so overriding
one is uncommenting rather than looking it up.

Values resolve most-specific-first, first match wins:

| | source | |
| --- | --- | --- |
| 1 | a real environment variable | what a container is given, so images ship no `.env` at all |
| 2 | `api/.env.local` · `web/.env.local` | package, untracked |
| 3 | `api/.env` · `web/.env` | package, committed — override slots, shipped fully commented out |
| 4 | `.env.local` | repo, untracked — where most overrides belong |
| 5 | `.env` | repo, committed — every variable, with its default |
| 6 | the built-in default | `api/src/config.ts` |

The nearest scope wins outright and, within a scope, the untracked file beats the committed one:
the usual monorepo convention composed with the usual dotenv one. The root file is not a fallback
for leftovers — it carries the full set, and the package files exist only so one half can be
pointed somewhere the other should not follow. They ship with every line commented out, because a
live value in one would outrank the file people actually edit.

Only `VITE_`-prefixed variables are readable from browser code, which is why the api's secrets
sit in the same files without reaching the bundle.

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
| `VITE_API_TARGET` | **web, development only:** where the dev server proxies `/api`; a build talks to whatever origin serves it |

`AUTH_MODE` falls back to `local` — the mode that needs nothing configured and still holds the
door, since the first account is created through a setup form gated by a token printed at
startup. A misspelled value therefore lands on the safe mode rather than refusing to boot, and
says so on stderr.

## Layout

```
diele/
├── web/        the launcher — Vue 3, Vite                        → web/README.md
├── api/        sign-in, storage, connectors — Express 5, SQLite  → api/README.md
├── common/     the wire types both sides share
├── extension/  Chrome new tab override, no build step            → extension/README.md
└── data/       the SQLite database, created on first boot, gitignored
```

`common` is types only and emits nothing but declarations, so neither side gains a runtime
dependency on the other — but a field renamed on one side stops compiling on the other instead
of arriving as a silently missing value. What belongs there and what does not is written down in
[CONTRIBUTING.md](CONTRIBUTING.md).

The web app is served on its own origin in development and talks to the API through the Vite
proxy, so the session cookie is first-party in every environment and there is no CORS handling
anywhere in the codebase.

## Not here yet

- **Docker images**, three of them: one combined, and one each for the api and the web app
  alone. They will be configured by environment variables and carry no `.env`, which is what the
  precedence above is for.

  Until then, self-hosting is two processes behind whatever already serves your other things:

  ```sh
  npm ci
  npm run build

  npm start                        # the api, on PORT
  npm run preview -w @diele/web    # the built web app, for a quick look
  ```

  `preview` is Vite's own static server and is meant for checking a build, not for running one.
  For anything lasting, point nginx or Caddy at `web/dist` as the site root with a fallback to
  `index.html`, and proxy `/api` to the api process. Both halves have to answer on one origin, so
  that `PUBLIC_ORIGIN` matches and the session cookie stays first-party.
- **Connectors** for GitHub, Uptime Kuma, Prometheus, Grafana and Notion. They are listed in the
  admin panel already, each declaring the capabilities it will answer to, which is where the
  shape they are expected to take is written down.
- **User management and role-based permissions.** The `groups` claim is already carried onto the
  session, so the seam is there.

## License

Copyright (C) 2026 Bernhard Kelm

diele is free software under the **GNU Affero General Public License, version 3 or later**. You
may use, study, change and redistribute it. See [LICENSE](LICENSE) for the full text.

The Affero part matters here, because diele is something people host: section 13 says that if you
run a **modified** version and let others use it over a network, you have to offer those users
the source of your modified version. Running it unmodified, for yourself or your team, asks
nothing of you.
