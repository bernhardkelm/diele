const DIRECTORY_ENTRY_BYTES = 16
const HEADER_BYTES = 6

/** An image inside the container, already encoded. */
export interface IcoEntry {
  readonly size: number
  readonly png: Buffer
}

/**
 * Packs encoded PNGs into an `.ico`.
 *
 * The format predates PNG and its own bitmaps carry a mask nobody wants to write, but every
 * browser back to IE11 reads a PNG inside the container, and the container is only there because
 * `/favicon.ico` is still requested by things that never read the document.
 * @param {ReadonlyArray<IcoEntry>} entries - Images to pack, smallest first
 * @returns {Buffer} - The encoded file
 */
export function encodeIco(entries: ReadonlyArray<IcoEntry>): Buffer {
  const header = Buffer.alloc(HEADER_BYTES)
  header.writeUInt16LE(0, 0)
  // 1 is an icon, 2 would be a cursor.
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(DIRECTORY_ENTRY_BYTES * entries.length)
  let offset = HEADER_BYTES + directory.length

  entries.forEach((entry, index) => {
    const at = index * DIRECTORY_ENTRY_BYTES

    // A side is one byte, so 256 is written as 0. Nothing here is that large, but writing the
    // side unchecked is how a 256 pixel entry becomes a zero pixel one.
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at)
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1)
    directory.writeUInt8(0, at + 2)
    directory.writeUInt8(0, at + 3)
    directory.writeUInt16LE(1, at + 4)
    directory.writeUInt16LE(32, at + 6)
    directory.writeUInt32LE(entry.png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)

    offset += entry.png.length
  })

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)])
}
