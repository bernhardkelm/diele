import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ApiBrand } from '@diele/common'
import { buildFavicons } from '#favicon/assets.js'

const BRAND: ApiBrand = {
  title: 'homelab',
  subtitle: 'start page',
  accentLight: '#1e88e5',
  accentDark: '#ff7043',
}

const assets = buildFavicons(BRAND)

test('every name the document asks for is answered', () => {
  assert.deepEqual([...assets.keys()].sort(), [
    '/favicon/apple-touch-icon.png',
    '/favicon/favicon-96x96.png',
    '/favicon/favicon.ico',
    '/favicon/favicon.svg',
    '/favicon/site.webmanifest',
    '/favicon/web-app-manifest-192x192.png',
    '/favicon/web-app-manifest-512x512.png',
  ])
})

test('each carries the type it is served under', () => {
  assert.equal(assets.get('/favicon/favicon.svg')!.type, 'image/svg+xml')
  assert.equal(assets.get('/favicon/favicon.ico')!.type, 'image/x-icon')
  assert.equal(assets.get('/favicon/apple-touch-icon.png')!.type, 'image/png')
  assert.equal(assets.get('/favicon/site.webmanifest')!.type, 'application/manifest+json')
})

// The whole point of drawing them here: a portal painted in someone else's colour would
// otherwise carry the stock mark on every tab, home screen and bookmark.
test('the mark is drawn in the configured accent', () => {
  const svg = assets.get('/favicon/favicon.svg')!.body.toString('utf8')

  assert.match(svg, /stroke="#ff7043"/)
  assert.doesNotMatch(svg, /#22c55e/)
})

test('the svg carries a viewBox, so it is the one icon that scales rather than being picked', () => {
  const svg = assets.get('/favicon/favicon.svg')!.body.toString('utf8')

  assert.match(svg, /viewBox="0 0 64 64"/)
})

test('the manifest names the deployment rather than the project', () => {
  const manifest = JSON.parse(assets.get('/favicon/site.webmanifest')!.body.toString('utf8'))

  assert.equal(manifest.name, 'homelab')
  assert.equal(manifest.short_name, 'homelab')
  assert.equal(manifest.display, 'standalone')
})

// Without them chrome holds the manifest to be uninstallable, and every icon below it is drawn
// for a prompt that never appears.
test('the manifest carries the fields an install is offered on', () => {
  const manifest = JSON.parse(assets.get('/favicon/site.webmanifest')!.body.toString('utf8'))

  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.id, '/')
})

// Both, because the icon is a full square: a launcher that masks it loses nothing, and one that
// does not is left with the shape as drawn rather than a circle inside a box.
test('the manifest icons are offered masked and unmasked', () => {
  const manifest = JSON.parse(assets.get('/favicon/site.webmanifest')!.body.toString('utf8'))

  assert.deepEqual(
    manifest.icons.map((icon: { src: string; sizes: string; purpose: string }) => [
      icon.src,
      icon.sizes,
      icon.purpose,
    ]),
    [
      ['/favicon/web-app-manifest-192x192.png', '192x192', 'any maskable'],
      ['/favicon/web-app-manifest-512x512.png', '512x512', 'any maskable'],
    ],
  )
})

test('the ico holds three sides, each a png the container points at', () => {
  const ico = assets.get('/favicon/favicon.ico')!.body

  assert.equal(ico.readUInt16LE(0), 0)
  // 1 is an icon, 2 would be a cursor
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 3)

  for (let index = 0; index < 3; index += 1) {
    const at = 6 + index * 16
    const side = ico.readUInt8(at)
    const length = ico.readUInt32LE(at + 8)
    const offset = ico.readUInt32LE(at + 12)

    assert.deepEqual([16, 32, 48][index], side)
    assert.deepEqual(
      ico.subarray(offset, offset + 8),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'each entry is a png',
    )
    assert.equal(offset + length <= ico.length, true, 'each entry lies inside the file')
  }
})
