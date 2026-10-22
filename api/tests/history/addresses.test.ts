import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  classifyAddress,
  classifyHostname,
  embeddedIpv4,
  isUnreachable,
} from '#history/addresses.js'
import { literalAddress, publicAddress, resolveAll } from '#history/resolve.js'

test('each range is classified where it leads', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['127.0.0.1', 'loopback'],
    ['127.8.9.10', 'loopback'],
    ['0.0.0.0', 'loopback'],
    ['::1', 'loopback'],
    ['::', 'loopback'],
    ['169.254.169.254', 'linkLocal'],
    ['100.100.100.200', 'linkLocal'],
    ['fe80::1', 'linkLocal'],
    ['fd00:ec2::254', 'linkLocal'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.10', 'private'],
    ['100.64.0.1', 'private'],
    ['fd12:3456::1', 'private'],
    ['172.32.0.1', 'public'],
    ['8.8.8.8', 'public'],
    ['2606:4700::1111', 'public'],
  ]

  for (const [address, expected] of cases) {
    assert.equal(classifyAddress(address), expected, address)
  }
})

// Both forms reach the ipv4 host, so they are judged as it.
test('ipv4-mapped and NAT64 addresses count as the ipv4 address they carry', () => {
  assert.equal(embeddedIpv4('::ffff:127.0.0.1'), '127.0.0.1')
  assert.equal(embeddedIpv4('::ffff:7f00:1'), '127.0.0.1')
  assert.equal(embeddedIpv4('64:ff9b::a9fe:a9fe'), '169.254.169.254')
  assert.equal(embeddedIpv4('2606:4700::1111'), undefined)

  assert.equal(classifyAddress('[::ffff:7f00:1]'), 'loopback')
  assert.equal(classifyAddress('::ffff:10.0.0.1'), 'private')
  assert.equal(classifyAddress('64:ff9b::a9fe:a9fe'), 'linkLocal')
})

// Public means global unicast and nothing else; every special-purpose block is dropped.
test('a special-purpose address is never public', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['::ffff:0:7f00:1', 'loopback'],
    ['::ffff:0:127.0.0.1', 'loopback'],
    ['::7f00:1', 'loopback'],
    ['::127.0.0.1', 'loopback'],
    ['::ffff:0:10.0.0.1', 'private'],
    ['fec0::1', 'reserved'],
    ['2002:c000:204::1', 'reserved'],
    ['2002:7f00:1::1', 'reserved'],
    ['64:ff9b:1::1', 'reserved'],
    ['2001:db8::1', 'reserved'],
    ['3fff::1', 'reserved'],
    ['2001::1', 'reserved'],
    ['ff02::1', 'reserved'],
    ['100::1', 'reserved'],
    ['198.18.0.1', 'reserved'],
    ['198.19.255.255', 'reserved'],
    ['240.0.0.1', 'reserved'],
    ['224.0.0.1', 'reserved'],
    ['239.255.255.250', 'reserved'],
    ['255.255.255.255', 'reserved'],
    ['192.0.0.1', 'reserved'],
    ['192.0.2.1', 'reserved'],
    ['198.51.100.1', 'reserved'],
    ['203.0.113.1', 'reserved'],
    ['192.88.99.1', 'reserved'],
  ]

  for (const [address, expected] of cases) {
    assert.equal(classifyAddress(address), expected, address)
  }
})

test('an embedded public ipv4 address is public, and so is global unicast ipv6', () => {
  for (const address of [
    '64:ff9b::8.8.8.8',
    '::ffff:8.8.8.8',
    '::ffff:0:8.8.8.8',
    '2a00:1450:4001::1',
    '2606:4700::1111',
  ]) {
    assert.equal(classifyAddress(address), 'public', address)
  }
})

test('the dropped classes are told apart from the kept ones', () => {
  assert.equal(isUnreachable('loopback'), true)
  assert.equal(isUnreachable('linkLocal'), true)
  assert.equal(isUnreachable('reserved'), true)
  assert.equal(isUnreachable('private'), false)
  assert.equal(isUnreachable('public'), false)
  assert.equal(isUnreachable(undefined), false)
})

test('something that is not an address counts as the safe end', () => {
  assert.equal(classifyAddress('not-an-address'), 'loopback')
})

test('the spellings that reach loopback by name alone are caught before resolving', () => {
  for (const host of [
    'localhost',
    'app.localhost',
    '[::ffff:7f00:1]',
    '0.0.0.0',
    '[::]',
    '127.1.2.3',
  ]) {
    assert.equal(classifyHostname(host), 'loopback', host)
  }

  assert.equal(classifyHostname('metadata.google.internal'), 'linkLocal')
  assert.equal(classifyHostname('grafana.example'), undefined)
})

// One address that is not public among them, or none at all, and nothing is requested.
test('only a resolution in which every address is public gives one to probe', () => {
  assert.equal(publicAddress(['93.184.216.34', '2606:2800:220:1::1']), '93.184.216.34')
  assert.equal(publicAddress(['127.0.0.1']), undefined)
  assert.equal(publicAddress(['192.168.1.5']), undefined)
  assert.equal(publicAddress(['8.8.8.8', '10.0.0.1']), undefined)
  assert.equal(publicAddress(['8.8.8.8', '169.254.169.254']), undefined)
  assert.equal(publicAddress(['8.8.8.8', '::ffff:127.0.0.1']), undefined)
  assert.equal(publicAddress([]), undefined)
  assert.equal(publicAddress(undefined), undefined)
})

test('an ip literal is read as written, a name is not an address', () => {
  assert.equal(literalAddress('93.184.216.34'), '93.184.216.34')
  assert.equal(literalAddress('[2606:2800:220:1::1]'), '2606:2800:220:1::1')
  assert.equal(literalAddress('example.com'), undefined)
})

// c-ares asks the nameservers only, so a name nobody serves answers nothing rather than throwing.
test('a name that does not resolve has no addresses', async () => {
  assert.deepEqual(await resolveAll('does-not-resolve.invalid'), [])
})
