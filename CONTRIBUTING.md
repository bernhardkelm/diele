# Contributing

## Scope

diele is a self-hosted new tab page: a launcher and service catalogue for everything you run, for
one person or for a group. It **discovers** what exists instead of asking anyone to declare it, and
it is meant to be deployed in an afternoon by one person. Both halves of that are the product.

Nothing here assumes a company. A single user with a homelab and a group with an identity provider
are the same installation with different settings, and a feature that only makes sense at one of
those scales is a feature that does not fit.

Things it is not, and will not become:

- **an everything portal** - no CRM tiles, no news feed, no intranet
- **a plugin framework** - connectors are compiled in, and the registry is an allowlist
- **a wiki or a docs host** - it links to yours
- **a permission system** - what a person may see is decided by the source, never by a table here

An issue proposing one of these gets a link to this section rather than an argument.

## Before opening a pull request

Bugfixes: send them. Anything else - a connector, a setting, a field on a shared type, a change to
the rules below - open an issue first.

Unmerged work is not wasted; merged work is maintained forever. That asymmetry is why the answer to
a large unannounced pull request is usually no, and why it is worth ten minutes in an issue before
a weekend in an editor.

## A default is cheaper than a setting

Every option is a permanent branch, in the code and in every support conversation afterwards. A
proposal to make something configurable has to say why **both** behaviours are legitimately correct.
"My setup differs" is a case for changing the default, not for adding a switch.

## Connectors are cheap, the model is not

New connectors are welcome - any source that maps onto the entry shape that already exists.

Widening that shape is the expensive part: a core field added for one source becomes a null
everywhere else, and both renderers have to handle it. Source-specific data belongs in the entry's
own payload, read only by the code that produced it. If a connector cannot be written without a new
core field, open a discussion before writing it.

## AI-assisted contributions

Fine, at the same bar as anything else: you understand every line and can defend it in review. A
pull request whose author cannot explain a decision in it is closed regardless of what wrote it.

---

The rest of this file is only the conventions that needed writing down. Where it is silent, follow
the surrounding code.

Run `npm run lint`, `npm run type-check` and `npm test` from the root before opening a pull request.
Formatting is `oxfmt`'s business (`npm run format`); do not hand-format around it.

## The three packages

| package | is |
| --- | --- |
| `web/` | the launcher - Vue 3, Vite, no router, no state library |
| `api/` | sign-in, storage and connectors - Express 5, SQLite, zod |
| `common/` | the wire types both sides share |

`extension/` sits alongside them but is not a workspace: plain manifest v3 files, no dependencies,
no build step. It is loaded unpacked from a folder, so anything requiring a build breaks it. Keep it
that way.

### What belongs in `common`

`common` holds **the shapes that cross the wire**, and nothing else. It emits declarations only, so
neither package gains a runtime dependency on the other - but a field renamed there stops compiling
on both sides at once, which is the whole reason it exists.

A type belongs there when the api serves it and the web app reads it. Four things deliberately do
not, and the reasoning generalises:

- `api/src/connectors/refs.ts` - the api derives every ref and the client only compares them. One
  consumer is not a shared unit.
- `api/src/connectors/types.ts` - the connector contract never leaves the server.
- `web/src/types/portal.ts` - what the app *renders*, not what it *receives*. `CommandTarget`
  carries a `run: () => void`; nothing like that crosses a wire.
- `web/src/config/api.ts` - endpoint paths and `localStorage` keys, both browser-only.

When you add a payload, put its type in `common` and annotate the route with it
(`const payload: ApiConfig = { … }`). An untyped `res.json({ … })` is how the two sides drift.

`common/src/index.ts` is the one barrel file in the repo, because it is a package entry point and
defines a public surface. Do not add barrels anywhere else.

## Where code goes - `web/`

| directory | holds |
| --- | --- |
| `src/views/` | the full-screen states `App.vue` switches between, and anything private to one |
| `src/components/` | everything reusable, grouped by nothing but being reusable |
| `src/composables/` | anything that owns reactive state or uses a lifecycle hook |
| `src/helpers/` | pure functions, and the I/O boundary named below |
| `src/config/` | values decided once, not computed |
| `src/types/` | `portal.ts`, what the app renders; wire shapes come from `@diele/common` |

A view fills the screen on its own. `AdminView`, `StyleguideView` and `LoginGate` are the branches
`App.vue` picks between, and only two are reachable by a hash route - being a route is not the test.

A component used by exactly one view lives beside it, which is why `StyleguideTokenRow` sits in
`views/`. Move it out the day a second view needs it.

A composable returns what its consumers use, not everything it holds. Add a member back the day
something calls it.

### Helpers are pure, except the I/O boundary

Four modules are the only place in `web/src/helpers` allowed to touch the outside world:

| module | what it touches |
| --- | --- |
| `storage.ts` | `localStorage` - the only module in the app that does |
| `apiError.ts` | reads a `Response` body |
| `brandAccent.ts` | writes a custom property onto `documentElement` |
| `styleguideTokens.ts` | `getComputedStyle`, and a DOM probe it cleans up after |

Anything else needing the network, storage or the DOM belongs in a composable.

The test is not "does it have side effects" - it is **does it own reactive state or a lifecycle**.
These four own neither, and `storage.ts` is deliberately callable from module scope before anything
mounts. A `services/` layer would group them by a property rather than a concern, which is the thing
these rules exist to prevent.

Adding to this table is a decision: it is where the app stops being testable by calling a function
with an argument.

### Failure handling

Which of the four classes a failure belongs to decides how it is handled. They are written out at
the top of [`web/src/helpers/apiError.ts`](web/src/helpers/apiError.ts), next to the code that
formats the only class a person ever reads.

### Styling

Shared visual grammar lives in [`web/src/styles/base.css`](web/src/styles/base.css) as opt-in
classes, because Vue's scoped styles cannot share a rule without a preprocessor. Component styles
keep only what differs.

| class | on |
| --- | --- |
| `.truncate` | any text that must stay one line |
| `.row-tracks` | the list that holds the three columns |
| `.row-grammar` | the element that paints them |
| `.row-grammar-pass` | a wrapper that only forwards them to the element inside it |
| `.row-marker` | a row whose own state decides when the marker shows |
| `.row-marker-focus` | a row marked while it holds focus |
| `.row-marker-within` | a row marked while anything inside it does |

Marker offsets are `--row-marker-left` and `--row-marker-top`, set on the row rather than overridden
on its pseudo-element. Design values are tokens in
[`web/src/styles/tokens.css`](web/src/styles/tokens.css); the one literal that could not become a
token is the `640px` breakpoint, and it says so there.

`#/styleguide` renders the real components, so it cannot drift from what ships. Add a specimen by
rendering the component, never by imitating its markup.

## Where code goes - `api/`

One directory per domain, each holding the same three kinds of file:

| file | holds |
| --- | --- |
| `repository.ts` | the SQL, as prepared statements, and nothing else |
| `schemas.ts` | the zod schemas requests are parsed with |
| `routes.ts` | the express router, in `admin/` for everything under `/api/admin` |

**There is no service layer, and adding one needs an argument.** Domain logic that is not SQL lives
in small pure modules beside the domain - `refs.ts`, `toggles.ts`, `sanitize.ts`, `redact.ts`,
`wire.ts` - not in a class wrapping the repository to no effect.

Requests are validated at the edge with zod and trusted afterwards. A handler re-checking what its
schema guaranteed is dead code that will drift.

Errors are the constructors in `src/errors.ts` (`badRequest`, `unauthorized`, `forbidden`,
`notFound`, `conflict`, `tooManyRequests`, `unavailable`). Throw one; the handler in `app.ts` turns
it into a response. Do not write status codes in handlers.

### Migrations

An ordered array in `src/db/migrations/`, one transaction each, with `PRAGMA user_version` as the
ledger. **A shipped migration is immutable** - fix it forward. Nothing is ever removed from the
array, because the number a database records is an index into it.

### A new connector

Implement `ConnectorModule` in `src/connectors/<type>/module.ts` and register it in
`src/connectors/registry.ts`, the allowlist. Declare `fields` and `produces`, and the admin form and
the rendering both follow - neither package needs a line of connector-specific code. Capabilities
are read off the methods you implement, so implement `collect` and you have `entries`.

Give it a `verify`. A save is refused unless the settings actually reach the source, and that check
is the difference between a bad token being reported at the panel and being discovered as an empty
list a day later.

Map to `ProducedEntry` with actions already expanded into absolute urls. The client renders and
never builds.

### Tests

`node:test` through `tsx`, beside the code as `*.test.ts`. The bar is not coverage - it is **would
this be silent if it broke**. The three that exist are there because each fails quietly: a sealed
secret that does not open back, a partial sync that sweeps rows it should have left, a malformed
upstream entry that throws instead of being dropped.

The suite runs against a throwaway `./.test.db` and sets its own environment in the `test` script,
so it must pass on a clean checkout with no `.env` present.

### Configuration

A new setting is added in **three** places: a working default in the committed [`.env`](.env), the
same line commented out in [`.env.local.example`](.env.local.example), and a read in
`api/src/config.ts` rather than a `process.env` lookup from a handler. One place names it, one
defaults it, one is where people go to override it.

The committed `.env` carries **every** variable both halves read; `api/.env` and `web/.env` are
override slots and must stay fully commented out. A live value in one outranks the repo-wide file
people actually edit, which is how a default becomes impossible to change.

Never put a secret in a committed `.env`, and never require any `.env` to exist. They are the
development convenience - a container is configured by real environment variables, which win over
every file, and an image ships no `.env` at all.

## Conventions across both

- **Comments explain a constraint the code cannot show.** No narration of the next line, no history
  of how something got here.
- **Documentation, commit messages and pull request descriptions are English**, whatever language
  the discussion happened in.
- **Never reach through `../` out of a package.** `web` uses the `@/` alias, `api` uses relative
  sibling paths with the `.js` extension `nodenext` requires, and anything shared comes from
  `@diele/common`.
- **Braces on every block**, including a single-statement guard. `curly: ["error", "all"]` is on in
  both packages.
- **Nothing private in a commit.** No internal hostnames, group names, tokens or customer names,
  including in fixtures and placeholder text. `example.com` and `example-group` are the conventions.

## License

By contributing you agree that your contribution is licensed under the
[GNU AGPL v3 or later](LICENSE), the same terms as the rest of the project.
