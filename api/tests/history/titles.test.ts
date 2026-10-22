import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanTitle, MAX_TITLE, titleHash } from '#history/titles.js'

// Each can make a rendered title read as something it is not, or hide text in it.
test('format characters are removed from a title', () => {
  for (const char of ['‎', '‏', '؜', '​', '‌', '‍', '⁠', '﻿', '‮', '⁦', '\u{e0041}', '\u{e007f}']) {
    const code = char.codePointAt(0)?.toString(16)

    assert.equal(cleanTitle(`Pay${char}roll`), 'Payroll', code)
  }
})

test('control characters become spaces and whitespace collapses', () => {
  assert.equal(cleanTitle('  Pay\u0000roll\n\treport\u0007  '), 'Pay roll report')
})

test('a title is capped, and one with nothing left is no title', () => {
  assert.equal(cleanTitle('x'.repeat(MAX_TITLE + 50))?.length, MAX_TITLE)
  assert.equal(cleanTitle('​‎  \u0000'), undefined)
  assert.equal(cleanTitle(undefined), undefined)
})

test('a title digest tells titles apart without keeping them', () => {
  assert.equal(titleHash('One'), titleHash('One'))
  assert.notEqual(titleHash('One'), titleHash('Two'))
  assert.equal(titleHash('One').includes('One'), false)
})
