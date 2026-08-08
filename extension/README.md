# diele new tab

An unpacked Chrome extension that makes your diele instance the new tab page.

Chrome has no setting for this: *On startup* only applies at launch, and the home button
navigates the current tab. Overriding the new tab page requires an extension, and
`chrome_url_overrides` may only point at a page inside the extension — hence the redirect in
[`newtab.js`](newtab.js) rather than the url itself.

Store extensions do the same thing, usually with permission to observe every new tab you open.
This one asks for `storage` and nothing else: no host permissions, no tabs, no third-party
code, no build step.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Open a new tab and enter the address of your instance

The first new tab is also the setup step: with nothing stored yet it shows a field instead of
redirecting, so there is no file to edit before loading.

Chrome keeps unpacked extensions across restarts. It re-flags them on each launch with a
"disable developer mode extensions" prompt — dismissing it keeps the extension enabled.

## Changing the target

`chrome://extensions` → **Details** → **Extension options**. Saving offers to open the address
straight away, so a typo shows up there rather than on the next new tab.

The address is kept in `chrome.storage.sync`, so it follows you to your other signed-in browsers
and survives an update of the extension.

## What counts as an address

A bare host is accepted and assumed https, so `diele.example.com` becomes
`https://diele.example.com/`. A host with a port works the same way, and an explicit
`http://localhost:3000` is left alone.

Anything carrying some other scheme is refused rather than mangled into an https url, and so is
anything whose hostname is not a hostname. Both checks matter because the stored value is handed
to `location.replace` on every new tab.

Worth knowing if you change that validation: a browser does **not** throw on
`new URL('https://not a url')` — it percent-encodes the mess into the hostname and returns
happily, where Node's parser rejects the same string. The hostname is therefore checked against
a pattern rather than the constructor being trusted to fail.

## Other browsers

Edge, Brave, Vivaldi and Opera load the same folder through their own `chrome://extensions`.
Firefox needs `browser_specific_settings` in the manifest and reads the same
`chrome_url_overrides` key, but its new tab override behaves differently enough to want its own
testing — it has not been tried.

## Known quirk

Chrome focuses the address bar when a tab opens, and the redirect can swallow the first
keystroke or two if you type immediately after `Cmd`/`Ctrl`+`T`. Every redirect-based new tab
extension shares this. An `<iframe>` would avoid it by leaving the address bar alone, but only
if your instance sends framing headers that allow it, which one behind an auth proxy generally
does not.

## Files

| file | is |
| --- | --- |
| `manifest.json` | manifest v3, `storage` permission only |
| `newtab.html` / `newtab.js` | the override: redirects, or asks where to go |
| `options.html` / `options.js` | changing the target later |
| `storage.js` | reading, writing and validating the url, shared by both pages |
| `shared.css` | diele's tokens, lockup and controls, copied rather than imported |
| `fonts/` | the three faces those styles ask for |

`shared.css` and `fonts/` are a copy of what the web app loads, because an unpacked extension
has no build step and cannot reach the `web` package. Keep them in step with
`web/src/styles/tokens.css` when the tokens move.

## Fonts

Space Grotesk, Inter and Geist Mono, latin subsets, one weight each — the same files the
launcher self-hosts, about 52 KB in total. All three are licensed
[OFL-1.1](https://openfontlicense.org), which permits redistribution as part of this extension;
the licence text and each font's copyright line travel with them in `fonts/OFL.txt`. They are
bundled rather than fetched because an extension page must load nothing from the network.
