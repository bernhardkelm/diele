import { crc32, deflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// 8 bits a channel, truecolour with alpha, no interlacing. The only combination worth writing:
// a palette would have to be built from an antialiased edge, which is where the colours are.
const BIT_DEPTH = 8
const COLOUR_TYPE_RGBA = 6

/** Filter 0, `None`. The image is flat colour either side of one edge, which deflate handles. */
const FILTER_NONE = 0

/**
 * Wraps data as a PNG chunk: its length, its name, itself, and the checksum over the last two.
 * @param {string} type - Four-character chunk name
 * @param {Buffer} data - Chunk payload
 * @returns {Buffer} - The chunk
 */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)

  const named = Buffer.concat([Buffer.from(type, 'ascii'), data])

  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(named))

  return Buffer.concat([length, named, checksum])
}

/**
 * Writes raw pixels as a PNG.
 * @param {Buffer} pixels - Rows of `rgba` bytes, top row first
 * @param {number} size - Side of the square image in pixels
 * @returns {Buffer} - The encoded file
 */
export function encodePng(pixels: Buffer, size: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.writeUInt8(BIT_DEPTH, 8)
  header.writeUInt8(COLOUR_TYPE_RGBA, 9)
  header.writeUInt8(0, 10)
  header.writeUInt8(0, 11)
  header.writeUInt8(0, 12)

  // Every scanline carries the filter it was written with, ahead of its pixels.
  const stride = size * 4
  const filtered = Buffer.alloc((stride + 1) * size)

  for (let row = 0; row < size; row += 1) {
    filtered[row * (stride + 1)] = FILTER_NONE
    pixels.copy(filtered, row * (stride + 1) + 1, row * stride, (row + 1) * stride)
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    // `deflateSync` emits the zlib stream, header and checksum included, which is what an IDAT
    // holds rather than a bare deflate stream.
    chunk('IDAT', deflateSync(filtered, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
