import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inflateSync } from 'node:zlib'
import { encodePng } from '#favicon/png.js'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Builds a square of one colour.
 * @param {number} size - Side in pixels
 * @param {ReadonlyArray<number>} rgba - The four channels every pixel carries
 * @returns {Buffer} - Raw pixels
 */
function solid(size: number, rgba: ReadonlyArray<number>): Buffer {
  return Buffer.from(Array.from({ length: size * size }, () => rgba).flat())
}

/**
 * Walks the chunks of an encoded file.
 * @param {Buffer} png - The encoded file
 * @returns {Array<{ type: string; data: Buffer }>} - Chunks in order
 */
function chunksOf(png: Buffer): Array<{ type: string; data: Buffer }> {
  const chunks: Array<{ type: string; data: Buffer }> = []
  let at = SIGNATURE.length

  while (at < png.length) {
    const length = png.readUInt32BE(at)
    chunks.push({
      type: png.toString('ascii', at + 4, at + 8),
      data: png.subarray(at + 8, at + 8 + length),
    })

    // length, type, payload and the checksum over the last two
    at += 12 + length
  }

  return chunks
}

test('the file opens with the png signature', () => {
  const png = encodePng(solid(2, [1, 2, 3, 4]), 2)

  assert.deepEqual(png.subarray(0, 8), SIGNATURE)
})

test('the header names the size and the format the pixels were written in', () => {
  const png = encodePng(solid(8, [0, 0, 0, 255]), 8)
  const header = chunksOf(png)[0]!

  assert.equal(header.type, 'IHDR')
  assert.equal(header.data.readUInt32BE(0), 8)
  assert.equal(header.data.readUInt32BE(4), 8)
  // 8 bits a channel, truecolour with alpha, no interlacing
  assert.equal(header.data.readUInt8(8), 8)
  assert.equal(header.data.readUInt8(9), 6)
  assert.equal(header.data.readUInt8(12), 0)
})

test('the chunks are the three a reader expects, in order', () => {
  const types = chunksOf(encodePng(solid(4, [9, 9, 9, 255]), 4)).map((chunk) => chunk.type)

  assert.deepEqual(types, ['IHDR', 'IDAT', 'IEND'])
})

// An IDAT holds a zlib stream, not a bare deflate one, which is what `deflateSync` emits and
// what `inflateSync` reads back here.
test('the pixels come back out of the image data, one filter byte a row', () => {
  const size = 3
  const png = encodePng(solid(size, [10, 20, 30, 40]), size)
  const data = chunksOf(png).find((chunk) => chunk.type === 'IDAT')!

  const raw = inflateSync(data.data)
  const stride = size * 4

  assert.equal(raw.length, (stride + 1) * size)

  for (let row = 0; row < size; row += 1) {
    assert.equal(raw[row * (stride + 1)], 0, 'every row is written unfiltered')
    assert.deepEqual(
      raw.subarray(row * (stride + 1) + 1, row * (stride + 1) + 1 + stride),
      Buffer.from(Array.from({ length: size }, () => [10, 20, 30, 40]).flat()),
    )
  }
})
