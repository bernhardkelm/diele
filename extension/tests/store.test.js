import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACCOUNT, INSTANCE, RECORDING, TARGET, setup } from './worker.js'

const TITLED = { ...TARGET, titles: true }

test('only the stripped url and a title that hides nothing reach storage', async () => {
  const { scripts, local } = setup({ dieleHistoryTarget: TITLED, dieleHistoryState: RECORDING })
  const raw = 'https://app.example.com/oauth/callback?code=SplxlOBeZQQYbYS6WxSbIA&state=xyz#frag'

  await scripts.recordHistoryVisit(raw, 'app.example.com/oauth/callback?code=Splx', Date.now())
  await scripts.recordHistoryVisit('https://docs.example.com/guide?tab=2', 'Guide', Date.now())

  const written = JSON.stringify(local)

  assert.deepEqual(
    local.dieleHistoryBuffer.visits.map((visit) => [visit.url, visit.title]),
    [
      ['https://docs.example.com/guide', 'Guide'],
      ['https://app.example.com/oauth/callback', undefined],
    ],
  )
  assert.doesNotMatch(written, /code=|state=|frag|tab=2|Splx/)
  assert.equal(local.dieleHistoryBuffer.account, ACCOUNT)
})

test('nothing is written until every switch is on', async () => {
  for (const local of [
    {},
    { dieleHistoryState: RECORDING },
    { dieleHistoryTarget: TARGET },
    { dieleHistoryTarget: TARGET, dieleHistoryState: { ...RECORDING, enabled: false } },
    { dieleHistoryTarget: TARGET, dieleHistoryState: { ...RECORDING, extension: false } },
    { dieleHistoryTarget: TARGET, dieleHistoryState: { ...RECORDING, signedIn: false } },
    { dieleHistoryTarget: TARGET, dieleHistoryState: { ...RECORDING, refused: true } },
    { dieleHistoryTarget: TARGET, dieleHistoryState: { ...RECORDING, account: undefined } },
    { dieleHistoryTarget: TARGET, dieleHistoryState: { ...RECORDING, account: '' } },
    {
      dieleHistoryTarget: { id: 'one', url: 'https://other.example/' },
      dieleHistoryState: RECORDING,
    },
  ]) {
    const { scripts } = setup(local)
    await scripts.recordHistoryVisit('https://docs.example.com/guide', 'Guide', Date.now())
    assert.equal(local.dieleHistoryBuffer, undefined, JSON.stringify(local))
  }
})

test('the instance itself and loads racing each other end up as one buffer', async () => {
  const { scripts, local } = setup({ dieleHistoryTarget: TARGET, dieleHistoryState: RECORDING })
  const now = Date.now()

  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      scripts.recordHistoryVisit(`https://site${index}.example/`, undefined, now - index),
    ).concat(scripts.recordHistoryVisit(`${INSTANCE}#/admin`, 'diele', now)),
  )

  assert.equal(local.dieleHistoryBuffer.visits.length, 20)
})

test('with titles off no title is stored, whatever the tab reported', async () => {
  const { scripts, local } = setup({
    dieleHistoryTarget: { ...TARGET, titles: false },
    dieleHistoryState: RECORDING,
  })

  await scripts.recordHistoryVisit(
    'https://mail.example.com/inbox',
    'Re: your diagnosis',
    Date.now(),
  )
  await scripts.recordHistoryVisit('https://docs.example.com/guide', 'Guide', Date.now())

  assert.equal(local.dieleHistoryBuffer.visits.length, 2)
  assert.doesNotMatch(JSON.stringify(local.dieleHistoryBuffer), /diagnosis|Guide|title/)
})

test('switching titles off strips those waiting, switching on records them cleaned', async () => {
  const { scripts, local } = setup({ dieleHistoryTarget: TITLED, dieleHistoryState: RECORDING })

  await scripts.recordHistoryVisit('https://docs.example.com/guide', 'Guide\u202E', Date.now())
  assert.equal(local.dieleHistoryBuffer.visits[0].title, 'Guide')

  await scripts.setHistoryTitles(false)
  assert.equal(local.dieleHistoryTarget.titles, false)
  assert.doesNotMatch(JSON.stringify(local.dieleHistoryBuffer), /Guide|title/)
  assert.equal(local.dieleHistoryBuffer.visits.length, 1)

  await scripts.setHistoryTitles(true)
  await scripts.recordHistoryVisit('https://docs.example.com/other', 'Other  page', Date.now())
  assert.equal(
    local.dieleHistoryBuffer.visits.find((visit) => visit.url.endsWith('/other')).title,
    'Other page',
  )
})
