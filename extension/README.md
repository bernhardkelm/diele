# diele new tab

An unpacked Chrome extension that makes your diele instance the new tab page, and switches between
several of them.

Chrome has no setting for this: _On startup_ only applies at launch, and the home button
navigates the current tab. Overriding the new tab page requires an extension, and
`chrome_url_overrides` may only point at a page inside the extension - hence the redirect in
[`newtab.js`](newtab.js) rather than the url itself.

Store extensions do the same thing, usually with permission to observe every new tab you open.
This one asks for `storage` and nothing else: no host permissions, no tabs, no third-party
code, no build step. That holds until you switch on [history](#history) for an instance, which
is the one thing here that needs more, asks for it at that moment and gives it back when switched
off again.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Open a new tab and enter the address of your instance

The first new tab is also the setup step: with nothing stored yet it shows a field instead of
redirecting, so there is no file to edit before loading.

Chrome keeps unpacked extensions across restarts. It re-flags them on each launch with a
"disable developer mode extensions" prompt - dismissing it keeps the extension enabled.

After updating the unpacked extension, reload it on `chrome://extensions`; if the history switch
still does nothing, restart the browser. Running diele from its dev server, the dev server must
proxy `/status` to the api, as `web/vite.config.ts` does; otherwise the row says `not diele`.

## Instances

The toolbar button holds the list. Add an address there, name it or leave it unnamed, and mark
which one new tabs open - a private portal and a work one, switched without retyping either.

Switching is silent: the marker moves, nothing navigates, and the next new tab goes to the newly
marked instance. **Open it** opens the marked one straight away, so a typo shows up there rather
than on the next new tab. A row with no name shows its hostname, and `×` removes it; removing the
marked one hands that role to the first one left.

Twenty instances is the cap, because `chrome.storage.sync` allows about 8 KB per item and a longer
switcher is a list nobody reads.

The same panel is the options page, at `chrome://extensions` → **Details** →
**Extension options**, for anyone who has unpinned the button.

The list is kept in `chrome.storage.sync`, so it follows you to your other signed-in browsers and
survives an update of the extension. An address stored by version 1.0.0, which held one, becomes
the first instance on upgrade; the marked one is still written to the key that version reads, so a
browser still running it keeps opening the same portal.

## History

diele can offer the pages you visited in its search, the way an address bar does. Its own bar
only sees what you open through it; this extension can send it every page you load in this
browser. Off at every level, and on only when all four are:

1. the instance offers history at all, its admin's **History** switch;
2. it accepts visits from the extension, the **From the extension** switch beneath it;
3. you opted in, under **History** in your settings there;
4. you switched it on here, on that instance's row in the toolbar panel.

The fourth is per browser, kept in `chrome.storage.local` rather than synced, and goes to one
instance at a time: switching it on for another switches it off for the first. It needs an https
address, or `http://localhost` and `http://127.0.0.1` for an instance under development, since
plain http would carry your session and your pages across the network in the clear.

### Permissions, and when

Switching it on is when the browser asks, and the prompt names everything:

| permission             | for                                                                            |
| ---------------------- | ------------------------------------------------------------------------------ |
| `webNavigation`        | seeing that a page finished loading                                            |
| `scripting`            | registering the small script that delivers the visits on your instance's pages |
| that instance's origin | running that script there, and nowhere else                                    |
| `tabs`                 | page titles, asked for only when you switch [titles](#page-titles) on as well  |

They are `optional_permissions` in the manifest, so installing or updating the extension asks for
none of them and shows no new warning. Whether a tab is incognito is readable without `tabs`, and
Chrome only shows an incognito tab's loads to an extension you allowed there, so the tab is looked
up only in that case or for its title. Switching history to another instance gives the first
one's origin back and `tabs` with it; switching it off gives all of them back. When switching on
cannot finish, because the browser refuses to register the script, history is left off and every
permission the prompt granted goes back; access granted for an instance that is no longer in the
list goes back the same way, and so does `tabs` granted for a titles switch that no longer applies.
There is no `webRequest`, and no access to any site but the one instance.

### What is recorded

A top-level page that finished loading: not a frame inside it, not a navigation that failed or
was aborted, not a page prerendered in the background, never an incognito tab. Before anything is
stored, the address is cut to its origin and path, and the page is dropped entirely when it is:

- not http(s), or longer than 2000 characters;
- one of your diele instances, this machine (`localhost`, `127.0.0.1`, `::1` and their other
  spellings), a link-local or cloud metadata address (`169.254.0.0/16`, `fe80::/10`,
  `metadata.google.internal`), or any other special-purpose address: documentation ranges,
  benchmarking, multicast, broadcast, 6to4 and the rest of the IANA registries. A private network
  (`192.168.0.0/16`, `fc00::/7` and the like) is kept;
- a search results page: Google, Bing, DuckDuckGo, YouTube and the like, and the instance's own
  engines and slash commands. A template with its term straight after the root, such as
  `https://github.com/{query}`, only covers a page one segment deep on that very host;
- a link carrying a key: a long random path segment, or an opaque id right after a word such as
  `reset`, `invite`, `login` or `share`. A slug there, `oauth2-setup-guide` or `release-2024`, is
  no key, and nothing further down the path is judged;
- on a domain you excluded in diele's settings.

Two kinds of load are not recorded although they finished:

- a page another one replaced in the same tab within 1.5 seconds. A load only counts once that long
  has passed without an error for it, and a newer load completing in the tab meanwhile takes its
  place. A tab closed in that time loses its page too whenever the tab has to be looked up, for its
  title or because the extension may run in incognito;
- a page Chrome prerendered from the address bar while you were still typing, and then showed. Its
  load finished while it was a prerender, which is skipped, and showing it is no new load.

These are the server's own rules, ported to the browser. The server applies all of them again,
plus the ones that need a name resolved, so the extension is the first filter and never the only
one.

### Page titles

Off by default, and a box of their own: once history is on for an instance, its row shows
`[ ] titles` beneath it. Off, a visit is its address and when it happened, nothing else; no
title is read from the tab, kept or sent. On, the browser asks for `tabs`, and the page's title
goes with each visit.

A title can say more than its address: a mail client puts the subject in it, an editor the
document's name, a ticket tracker the ticket's summary. The address is cut to origin and path all
the same. A title is dropped when it starts with a scheme or holds the host, which is what a
browser shows for a page with none, or holds a value from the query or the fragment the address
lost, which is how a search page names its term. A value counts from three characters, and only as
whole words, so `?tab=all` leaves "Install" alone; a single-label host such as `nas` is an ordinary
word too and is not looked for. Otherwise the title is kept, cleaned of control and direction
characters, and cut to 300 characters. The server applies the same rule again.

Switching titles off strips them from everything still waiting and gives `tabs` back. Each new
history target starts with them off.

### What never is

A query string, a fragment, a username or password in the address, `;jsessionid=` and its kind:
OAuth codes, `#access_token=` and search terms ride there, and none of it is written anywhere, not
even to the buffer. Nothing from incognito, nothing from a frame, nothing the page itself can
read.

### Delivery

Visits wait in `chrome.storage.local`, never sync, one entry per address with its latest visit,
at most 500 of them, at most 25 from any one site and none older than a week, so a page that
keeps navigating itself cannot push out everything else.

A site here is an approximation of the name its owner registered, since the public suffix list is
too large to ship: the last two labels of the host, or the last three when the second-to-last is a
common second-level label (`co`, `com`, `org`, `net`, `gov`, `ac`, `edu`), so `a1.evil.example`
and `a2.evil.example` share one cap and `shop.acme.co.uk` counts as `acme.co.uk`. An ip address is
a site of its own. The approximation errs both ways: every `github.io` page shares one cap, and a
rarer suffix like `ne.jp` is taken one label short. Either only changes whose visits share the 25.

On each load of your instance, a content script running on its pages only asks it what it
accepts from whoever is signed in, `GET /api/history/state`, which answers 401 when nobody is,
and posts what is waiting, 200 at a time, with that page's own session. Each batch goes out under a
lease: a second diele tab loading meanwhile, which is ordinary with diele as the new tab page, is
handed nothing rather than the same visits. The relay renews the lease every 10 seconds while its
post is in flight, and the lease lasts 120 seconds, since a background tab's timers may run only
once a minute. It is given back once the post is answered, delivered or not; one whose relay never
answered, a tab closed mid-post, runs out on its own after at most 120 seconds, and only the next
batch waits for it meanwhile. Recording, reports and the toolbar panel never do. Nothing is handed to the page: the script runs in the browser's isolated world and talks
to the extension alone. The one exception is a signal, not data: once the server took at least one
batch, the script dispatches a plain `diele:history-delivered` event on the page, after the last
batch, so the diele tab whose load delivered the visits reads its history again rather than
showing them only on the next tab. The event carries no detail, no count and no address, so a page
script firing the same event can only make diele re-read its own history. What the extension keeps
of the instance's engines and slash commands is only what recognising their results pages takes,
host, path and the parameter carrying the term, never a whole template with whatever key it holds.

A diele tab left open keeps sending too. Its relay runs again when you return to the tab, and
shortly after each visit: about 5 seconds after the last of a burst, the worker asks every open
diele tab of the target to send, once for the whole burst. It learns which tabs those are from
their relays alone, and forgets a tab once it closes or stops answering, so this needs no
permission beyond what history already holds. A tab runs at most every 10 seconds this way and
never twice at once, and asks the instance nothing while no visit waits. With no diele tab open,
visits wait in the buffer for the next one.

### diele must own its origin

The instance has to be the only app on its origin. Anything else served there shares the session
cookie, and so can already read your history through diele's own api; a service worker it
registered could also see the relay's requests. The relay asks `/status` first and stays silent
unless the answer looks like diele's, which keeps it quiet on a page that is plainly something
else, but anything on the same origin can answer the same way. When the answer is not diele's, the
extension only notes that, and the row says `not diele` until a load finds diele there again; what
waits is kept meanwhile. From the relay itself the page receives only the dataless
`diele:history-delivered` signal, never a visit, and any script of the page's that fires the same
event only triggers a harmless re-read of the history it already holds. Put diele on a host of its
own, not beside other apps under one domain and path prefixes.

The buffer belongs to the instance and the account it was recorded for, named by the `account`
the state carries: an opaque value derived from the account's history key, never its user id,
which a reset of the main database can hand to somebody new. Signed in as somebody else, the buffer
is dropped rather than sent, so a shared profile never puts one person's pages into another's
history. Signed out, nothing is recorded until someone signs in, and an account whose state names
no `account`, one that has never touched history, records nothing either. When the instance
answers that it does not accept visits after all, or says so when asked, what waits is discarded;
when it is only busy or unreachable, it waits for the next load.

The toolbar panel shows the last answer in a few words beside the box, `[×] history` followed by
one of:

| status                  | means                                                                          |
| ----------------------- | ------------------------------------------------------------------------------ |
| `open a diele tab once` | switched on, and the extension has not heard from the instance since           |
| `recording`             | every switch is on; `recording, 3 waiting` while visits wait for the next load |
| `signed out`            | nobody is signed in on the instance in this browser                            |
| `not opted in`          | you have not switched history on in the instance's settings                    |
| `not accepted here`     | the instance does not take visits from the extension                           |
| `not diele`             | the address does not answer `/status` the way diele does, so nothing is sent   |
| `no access`             | the browser did not grant what history needs                                   |
| `could not switch on`   | the browser would not register the relay, and everything went back             |
| `needs https`           | the instance is on plain http, and not this machine                            |

Beneath it, `[ ] titles` says `sent` or `not sent`.

### Switching it off

The same switch. Recording stops, the content script is removed, what waits is cleared, the titles
switch goes with it and every permission is given back. Removing the instance from the list or
changing its address, here or on a synced browser, does the same, and so does revoking
`webNavigation`, `scripting` or the instance's origin in the browser's own settings. Revoking
`tabs` there only switches titles off, the way their own switch does, and history goes on without
them. What the instance already holds stays there: forget it under **History** in diele's
settings, page by page or all at once.

## What counts as an address

A bare host is accepted and assumed https, so `diele.example.com` becomes
`https://diele.example.com/`. A host with a port works the same way, and an explicit
`http://localhost:3000` is left alone.

Anything carrying some other scheme is refused rather than mangled into an https url, and so is
anything whose hostname is not a hostname. Both checks matter because the stored value is handed
to `location.replace` on every new tab.

Worth knowing if you change that validation: a browser does **not** throw on
`new URL('https://not a url')` - it percent-encodes the mess into the hostname and returns
happily, where Node's parser rejects the same string. The hostname is therefore checked against
a pattern rather than the constructor being trusted to fail.

## Other browsers

Edge, Brave, Vivaldi and Opera load the same folder through their own `chrome://extensions`.
Firefox loads it too, see below. Safari has not been looked at yet.

## Firefox: built, untested

The same folder and the same `manifest.json` are meant to work in Firefox 128 or later, the first
release with `optional_host_permissions`. Nothing here has run in Firefox yet, so treat it as a
port that was read against Mozilla's documentation and not as one that was tried.

### Loading it

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → pick `manifest.json` in this folder
3. Open a new tab and enter the address of your instance

A temporary add-on lasts until Firefox quits. Keeping it installed takes a signed package, from
addons.mozilla.org or signed there for self-distribution; Developer Edition and Nightly also take
an unsigned one with `xpinstall.signatures.required` set to `false` in `about:config`.

### What differs from Chrome

- **One manifest for both.** Chrome reads `background.service_worker`, Firefox runs
  `background.scripts` as an event page, a page rather than a worker, from the same files.
  `background.js` only calls `importScripts` where it exists, and the manifest lists the files in
  the order that call does; a test keeps the two lists equal. Chrome 121 and later ignore
  `background.scripts` in a manifest v3 extension and show a warning for it on
  `chrome://extensions`, which is harmless; it ignores `browser_specific_settings` without one.
  Firefox in turn may note that it does not run `service_worker`.
- **The id.** Firefox needs one for an extension to keep its storage, so
  `browser_specific_settings.gecko.id` is `diele-new-tab@bernhardkelm.de`.
- **Ports.** Firefox's match patterns cannot name a port. There, the host permission and the relay
  cover every port of the instance's host, and the relay asks the extension first whether its
  page is the instance, compared on the full origin, before it requests anything at all; on
  another port it stays silent. In Chrome the patterns keep the port.
- **The relay's requests.** In manifest v3 a content script's `fetch` runs in the page's context
  in Firefox too, from Firefox 101, which is what carries the instance's `Origin` and session
  cookie. Firefox's older `content.fetch` exists only in manifest v2, so nothing here uses it.
- **Content scripts after an update.** Firefox drops scripts registered at runtime when the
  extension is updated or reloaded, so the relay is registered again on install and on startup.
- **Private windows.** Firefox does not run extensions in private windows unless you allow it in
  the add-on's settings. Allowed or not, nothing from a private window is recorded.
- **The new tab notice.** Firefox tells you an extension changed the new tab page, and asks
  whether to keep the change. Keep it. The home page, which Firefox sets apart from the new tab
  page, is not changed.
- **Not declared yet.** A listing on addons.mozilla.org would also need
  `data_collection_permissions`, which says what an extension sends out of the browser. History
  sends browsing activity, if only to your own instance; that declaration, and the consent
  prompt that comes with it, are for when this is published.

### What to check by hand

1. It loads in `about:debugging` without errors, and new tabs open the instance after the notice.
2. The toolbar panel adds, switches and removes instances; the options page shows the same.
3. Switching history on prompts for the instance's host and for reading browsing activity. Note
   whether the panel stays open while the prompt is up; if it closes, switching on should still
   finish, since the extension resumes it from the prompt's answer.
4. **The relay's post.** Open the instance, then the Network tab of its page:
   - `GET /status` and `/api/history/state` come first, then `/api/config`;
   - `POST /api/history/visits` must carry `Origin:` set to the instance's own origin and the
     session cookie, and answer 200 rather than 401;
   - a 401 here means Firefox sent no `Origin` or no cookie, and the relay keeps the visits
     instead of losing them.
5. The visits show under **History** in diele's settings, stripped to origin and path, without
   titles until the titles switch is on.
6. On an instance with a port, nothing is requested by the relay on another port of the same host.
7. Reload the add-on in `about:debugging` and open the instance again: visits still arrive.
8. Switching history off gives every permission back, under the add-on's **Permissions** tab in
   `about:addons`.
9. With visits waiting, open two tabs of the instance at once: the Network tabs together show each
   visit posted once, the second tab's relay posting nothing.

## Known quirk

Chrome focuses the address bar when a tab opens, and the redirect can swallow the first
keystroke or two if you type immediately after `Cmd`/`Ctrl`+`T`. Every redirect-based new tab
extension shares this. An `<iframe>` would avoid it by leaving the address bar alone, but only
if your instance sends framing headers that allow it, which one behind an auth proxy generally
does not.

## Files

| file                        | is                                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`             | manifest v3 for Chrome and Firefox, `storage` permission, history's as optional ones                                                                                                                           |
| `newtab.html` / `newtab.js` | the override: redirects, or asks where to go                                                                                                                                                                   |
| `popup.html` / `popup.js`   | the toolbar panel, and the options page: the list, and what changes it                                                                                                                                         |
| `storage.js`                | the list, which instance is marked, and the validation both pages share                                                                                                                                        |
| `popupHistory.js`           | the history switch on each row of the panel                                                                                                                                                                    |
| `background.js`             | the service worker in Chrome, the event page in Firefox, idle until history is switched on                                                                                                                     |
| `history/`                  | the filter, the buffer, the capture and the relay that delivers it                                                                                                                                             |
| `tests/`                    | `node:test` suites for the filter, the buffer, the relay, the switches and the panel, `npm run test:extension`; the filter also runs the server's own cases from `api/tests/history/fixtures/filterCases.json` |
| `shared.css`                | diele's tokens, lockup and controls, copied rather than imported                                                                                                                                               |
| `fonts/`                    | the three faces those styles ask for                                                                                                                                                                           |
| `icons/`                    | the app's own mark, at the four sizes Chrome asks for                                                                                                                                                          |

`shared.css`, `fonts/` and `icons/` are copies of what the web app loads, because an unpacked
extension has no build step and cannot reach the `web` package. Keep them in step with
`web/src/styles/tokens.css` when the tokens move; the icons are downscaled by hand from
`web/public/favicon/web-app-manifest-512x512.png`.

## Fonts

Space Grotesk, Inter and Geist Mono, latin subsets, one weight each - the same files the
launcher self-hosts, about 52 KB in total. All three are licensed
[OFL-1.1](https://openfontlicense.org), which permits redistribution as part of this extension;
the licence text and each font's copyright line travel with them in `fonts/OFL.txt`. They are
bundled rather than fetched because an extension page must load nothing from the network.
