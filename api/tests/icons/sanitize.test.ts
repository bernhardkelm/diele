import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sanitizeSvg } from '#icons/sanitize.js'

/**
 * Wraps icon markup in the smallest svg the sanitiser accepts.
 * @param {string} inner - Markup to place inside the root element
 * @returns {string} - Complete svg source
 */
function wrap(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`
}

// The xml parser this runs on reads the payload as one inert CDATA section. The browser does not:
// the portal inlines the result as html, and the html parser ends `<![CDATA[` at the first `>`,
// so everything after it becomes live markup in the portal's own origin.
test('a cdata section is removed rather than passed through', () => {
  const markup = sanitizeSvg(wrap('<title><![CDATA[x]><img src=x onerror="alert(1)">]]></title>'))

  assert.ok(!markup.includes('CDATA'))
  assert.ok(!markup.includes('onerror'))
  assert.ok(!markup.includes('<img'))
})

test('a script element does not survive', () => {
  const markup = sanitizeSvg(wrap('<script>alert(1)</script><path d="M0 0h10v10H0z"/>'))

  assert.ok(!markup.includes('script'))
  assert.ok(markup.includes('<path'))
})

test('event handlers are stripped from an element that is otherwise allowed', () => {
  const markup = sanitizeSvg(wrap('<path d="M0 0h10v10H0z" onload="alert(1)" ONERROR="alert(1)"/>'))

  assert.ok(!markup.toLowerCase().includes('onload'))
  assert.ok(!markup.toLowerCase().includes('onerror'))
  assert.ok(markup.includes('<path'))
})

test('a foreignObject subtree does not survive', () => {
  const markup = sanitizeSvg(
    wrap('<foreignObject><b xmlns="http://www.w3.org/1999/xhtml">x</b></foreignObject>'),
  )

  assert.ok(!markup.includes('foreignObject'))
  assert.ok(!markup.includes('<b'))
})

test('comments and processing instructions are removed', () => {
  const markup = sanitizeSvg(wrap('<!-- note --><?xml-stylesheet href="x.css"?><path d="M0 0"/>'))

  assert.ok(!markup.includes('note'))
  assert.ok(!markup.includes('xml-stylesheet'))
})

test('href keeps an internal fragment and loses everything else', () => {
  assert.ok(sanitizeSvg(wrap('<use href="#shape"/>')).includes('href="#shape"'))
  assert.ok(!sanitizeSvg(wrap('<use href="https://example.com/x.svg#s"/>')).includes('example.com'))
  assert.ok(!sanitizeSvg(wrap('<use href="javascript:alert(1)"/>')).includes('javascript'))
  assert.ok(!sanitizeSvg(wrap('<use href="data:image/svg+xml;base64,AAAA"/>')).includes('data:'))
})

test('clip-path and mask keep an internal reference and lose a scheme', () => {
  const internal = sanitizeSvg(wrap('<path d="M0 0" clip-path="url(#c)" mask="url(#m)"/>'))
  assert.ok(internal.includes('clip-path="url(#c)"'))
  assert.ok(internal.includes('mask="url(#m)"'))

  const scheme = sanitizeSvg(wrap('<path d="M0 0" clip-path="javascript:alert(1)"/>'))
  assert.ok(!scheme.includes('javascript'))

  const external = sanitizeSvg(wrap('<path d="M0 0" mask="url(https://example.com/m.svg#m)"/>'))
  assert.ok(!external.includes('example.com'))
})

test('paint is rewritten so the icon takes the colour around it', () => {
  const markup = sanitizeSvg(wrap('<path d="M0 0" fill="#ff0000" stroke="rgb(0,0,255)"/>'))

  assert.ok(markup.includes('fill="currentColor"'))
  assert.ok(markup.includes('stroke="currentColor"'))
})

test('an unfilled shape and an internal gradient keep their paint', () => {
  const markup = sanitizeSvg(wrap('<path d="M0 0" fill="none" stroke="url(#grad)"/>'))

  assert.ok(markup.includes('fill="none"'))
  assert.ok(markup.includes('stroke="url(#grad)"'))
})

test('a doctype or an entity declaration is refused', () => {
  assert.throws(() => sanitizeSvg('<!DOCTYPE svg><svg viewBox="0 0 10 10"/>'), /doctype/)
  assert.throws(() => sanitizeSvg('<!ENTITY x "y"><svg viewBox="0 0 10 10"/>'), /entities/)
})

test('a root that is not an svg is refused', () => {
  assert.throws(() => sanitizeSvg('<html><body>x</body></html>'), /must be an svg/)
})

test('an svg without a viewBox is refused, since the card cannot scale it', () => {
  assert.throws(
    () => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'),
    /viewBox/,
  )
})

test('fixed dimensions are dropped so the card sizes the icon', () => {
  const markup = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><path d="M0 0"/></svg>',
  )

  assert.ok(!markup.includes('width='))
  assert.ok(!markup.includes('height='))
  assert.ok(markup.includes('viewBox='))
})

test('an oversized file is refused before it is parsed', () => {
  assert.throws(() => sanitizeSvg(`<svg>${'x'.repeat(64 * 1024)}</svg>`), /larger than 64kb/)
})
