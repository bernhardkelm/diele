# @diele/web

The launcher: a centered grid of cards over saved sites and the rows connectors produce. Vue 3,
Vite, no router and no state library. See the [root README](../README.md) for what diele is and
how to start it; this file is the reference for the app itself.

It needs [`../api`](../api) running, otherwise it has no configuration to render and stops at
the login screen.

## Search

The bar is always present and takes focus on load, so a new tab can be typed into straight away.
It searches saved sites, the service cards and the connector rows together — by name, by url and
by keyword, so `example-group/web` finds the repo, `graf` finds Grafana and `3000` finds that
local port.

| key | does |
| --- | --- |
| `↵` | opens the highlighted entry, or searches the web when nothing is highlighted |
| `cmd`/`ctrl`+`↵` | the same, but alongside in a second tab |
| `↑` `↓` | move the highlight; stepping off either end returns to the field |
| `←` `→` | switch between a repo's own page, pipelines, merge requests and releases |
| `tab` / `shift+tab` | cycle the search engine forwards or back |
| `alt`+`1`-`9`,`0` | open that service card; holding `alt` reveals the badges |
| `/` | as the first character, opens the commands; from elsewhere on the page, focuses the field |
| `esc` | clear the term; again on an empty field releases focus |

A term that matches something local highlights the first match, so `↵` prefers what diele knows
over the web. To search anyway, `↑` steps off the list and hands `↵` back to the engine. A term
that is really a url (`example.com`, `localhost:3000`, a pasted link) leads the results as **Go
to**, and one written as a subreddit (`r/vuejs`, `/r/vuejs`) leads them as a jump to it.

On a phone the key hints drop out of the bar and the rows give up their left gutter for the
width, so the selection marker indents its own row instead of every row reserving space for it.
Tablets keep the desktop layout.

Everything opens in place rather than spawning a tab: diele is itself a new tab page, so another
tab would only pile up. Hold `cmd`/`ctrl` on `↵` or when clicking to open alongside instead.

Engines and saved sites come from the API, the first engine is the default, and every visit
starts there. Entries pointing at `localhost` are probed on load and whenever the tab regains
focus; the ones with something listening get a dot. Only reachable ports are marked, because a
blocked request and a dead port look identical from the browser.

## Slash commands

A term starting with `/` addresses the commands and nothing else — the cards, sites and repos sit
that search out, so a slash never fuzzy-matches its way into an ordinary result.

| typed | does |
| --- | --- |
| `/` | lists every command |
| `/admin` | opens the admin panel |
| `/logout` | ends the session |
| `/settings` | opens the settings view below |
| `/yt cats` | searches a configured command's target for `cats` |

`/admin`, `/logout` and `/settings` are built in and cannot be redefined; the rest are configured
in the admin view as a keyword plus a query url carrying `{query}`, the same shape a search
engine uses. A keyword carries no slash of its own, which is what keeps `/r/vuejs` a subreddit
jump.

Signing out is deliberately in two places: `/logout` for someone who knows it, and the settings
view for someone browsing for it.

## Settings

`#/settings` holds what this browser can be told about diele, and is the same page in a different
mode rather than a second app: the header, the search bar, the row grammar and the keyboard ring
are the admin view's own, with the subtitle reading `settings`. `/settings` in the launcher opens
it.

The theme is this device's business, so it lives in `localStorage` and is the one thing here a
lapsed session still changes. Hiding is not: an entry kept out of the list is a choice about the
instance rather than about the browser looking at it, so both scopes go to the API.

| key | does |
| --- | --- |
| `↑` `↓` | move the highlight through the list |
| `↵` | open the highlighted section, flip the highlighted switch, or run the highlighted action |
| `d` | flip the highlighted switch, the key the admin rows use for the same thing |
| `esc` | backs out one level: the list, then the term, then the open section, then the view |

Sections **expand in place** the way an admin feature does. A term narrows the open section rather
than dropping it, so a repo is reached by opening the repos and typing its name.

| section | holds |
| --- | --- |
| `Appearance` | the theme: follow the device, always light, always dark |
| `Hidden entries` | one switch per connector row, and a row bringing them all back while any are hidden |
| `Back to diele`, `Sign out` | the closing actions, rows in the same ring |

The hidden-entries section is listed whenever a connector is configured, whether or not it has
produced anything yet: one that is failing still has rows someone hid, and dropping the switch
would strand them. Entries are keyed by their **ref**, so the choice survives a repo being renamed
or moved between the configured groups.

The theme override is applied as `data-theme` on the root before the app mounts, so a pinned theme
does not flash the device's one first. Both palettes live once in
[`src/styles/tokens.css`](src/styles/tokens.css) as `light-dark()` pairs, and the override only
narrows `color-scheme` to re-resolve them all at once.

## Configuration

Cards, saved sites and search engines are rows in the API, not source files, and are edited in the
admin view below. Nothing here has to be rebuilt to change them.

The app reads them once per load through `GET /api/config` and paints from the previous visit's
`localStorage` copy first, revalidating behind it. That is deliberate: this is a new tab page, so
the API must never sit between opening a tab and seeing something. A lapsed session keeps the
cached page on screen rather than bouncing to the issuer — only a cold start with nothing cached
shows the login screen.

Icons are uploaded rather than bundled: the API sanitises an svg on the way in and rewrites its
paint to `currentColor`, so an uploaded logo is monochrome at rest and brand-coloured on hover
like the built-in ones. Open-source sources: [simple-icons](https://simpleicons.org) (CC0) for
most, and [`cncf/artwork`](https://github.com/cncf/artwork) for CNCF projects.

## Admin

`/admin` opens `#/admin`, which is the same page in a different mode rather than a second app: the
brand header, the search bar, the row grammar and the keyboard ring are the launcher's own
components, with the subtitle reading `admin` and the engine chip dropped.

Routing is the hash, so the view survives a reload and `#/admin/cards` names one section. A handful
of routes and a parameter do not earn a router dependency on a page that has to load as a new tab.

| key | does |
| --- | --- |
| `↑` `↓` | move the highlight through the list |
| `↵` | expand the highlighted feature, or run the highlighted action |
| `esc` | backs out one level: the term, then the open feature, then the admin view |

Everything configurable is one list, built-ins and connectors alike, and a feature **expands in
place** rather than navigating a level down. Each declares its own fields and the input mode each
needs, so the form is rendered from the API's description and a new connector needs no form code
here. Features with no editor yet say so and cannot be opened.

The list ends with the actions: exporting the whole configuration as a file, importing one back,
and leaving admin mode. They are rows rather than a footer so they sit in the same keyboard ring —
leaving is something to find in the list, not only a key nobody mentions. Connector credentials are
never in an export.

## Auth

Login is handled by the API, and there is nothing in front of the app — it is reachable by anyone
and shows nothing until a session exists. Which login screen appears follows the API's mode: a
single sign-on button, or a username and password form with a `remember me` box. On an instance
that has no account yet the same screen asks for one instead, gated by a setup token the server
prints at startup. See [`../api/README.md`](../api/README.md) for the flow.

## Styleguide

`#/styleguide` lists every design token as it resolves right now — the declaration, the value the
current theme paints, and a preview — followed by the recurring elements built from them. It has a
theme switch, so both sides of a `light-dark()` pair can be checked in one place.

Development only. `parseRoute` gates the route on `import.meta.env.DEV`, which is a literal `false`
in a build, so the view is unreachable and the bundler drops it: no chunk is emitted and none of its
markup, tokens or css reach `dist`.

## Connector entries

The rows below the cards come from `GET /api/entries`, which the API serves out of its own sync
cache — so this is a local read there rather than a trip to the forge, and a restart never leaves
the section empty while a source is asked again.

Nothing here knows what GitLab is. An entry arrives carrying a `ref`, a `kind` that says which
shape to draw it as, and its actions already expanded into absolute urls:

```json
{
  "ref": "gitlab:2:repo:1449",
  "kind": "row",
  "label": "example-app",
  "detail": "example-group",
  "url": "https://gitlab.com/example-group/example-app",
  "actions": [
    { "label": "", "title": "example-group/example-app", "href": "https://gitlab.com/example-group/example-app" },
    { "label": "ci", "title": "Pipelines", "href": "https://gitlab.com/example-group/example-app/-/pipelines" }
  ]
}
```

That is what made the second forge free here: GitHub produces `kind: 'row'` entries whose actions
point at `/actions`, `/pulls` and `/releases`, and not a line of this package changed.

The token, the instance and the groups are rows in the admin view under **GitLab**, stored
encrypted by the API. Adding a group is an edit in the browser rather than a config change and a
redeploy.

> GitLab caps token lifetime at one year. An expired token does not empty the list: the last good
> sync stands and the connector row reports the failure, which is where it becomes visible.

Entries are cached in `localStorage` under `diele:entries:v1` and revalidated behind the paint, the
same way the configuration is. Separate from `/api/config` on purpose: that payload changes only
when someone edits it, so its strong etag turns a new tab into a 304 with an empty body, and folding
entries in would bust that on every sync and send the inline icons again.

## Develop

From the repo root, `npm run dev` starts this and the API together. To drive this package alone:

```sh
npm run dev -w @diele/web        # hot-reload dev server, :5173
npm run type-check -w @diele/web # vue-tsc
npm run lint -w @diele/web       # oxlint + eslint
npm run build -w @diele/web      # type-check + production build to dist/
npm run preview -w @diele/web    # serve the production build
```

The dev server proxies `/api` to `localhost:3000` (`VITE_API_TARGET` to point elsewhere), so the
browser only ever talks to one origin and the session cookie is first-party.

`VITE_API_TARGET` is resolved in [`vite.config.ts`](vite.config.ts) through the same four-file
chain the api uses, so both halves follow one documented precedence — see
[`../.env.local.example`](../.env.local.example). It is read with `dotenv` rather than
`process.env`, which in a vite config only ever sees the shell, and rather than vite's own
`loadEnv`, which reads a single directory and so cannot express a package file outranking a
repo-wide one.

Never put a secret in a web env file: vite exposes every `VITE_`-prefixed variable it finds to
browser code, so it would ship inside the bundle.

> Tip: verify dark mode via DevTools → Rendering → "Emulate CSS prefers-color-scheme: dark", and
> the override on top of it in `#/settings`.
