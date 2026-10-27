import { mkdir, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'

// Original geometric price-list icon; no graphics tools are needed to regenerate it.
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(name: string, data: Buffer): Buffer {
  const type = Buffer.from(name)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])))
  return Buffer.concat([size, type, data, crc])
}
function png(size: number): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      let color = [25, 89, 166, 255]
      if (u < 0.04 || u > 0.96 || v < 0.04 || v > 0.96)
        color = [0, 0, 0, 0]

      if (u > 0.22 && u < 0.78 && v > 0.16 && v < 0.84)
        color = [245, 249, 255, 255]

      if (
        u > 0.3 &&
        u < 0.7 &&
        ((v > 0.28 && v < 0.34) || (v > 0.43 && v < 0.49))
      )
        color = [25, 89, 166, 255]

      if (u > 0.3 && u < 0.7 && v > 0.6 && v < 0.73)
        color = [26, 143, 106, 255]

      raw.set(color, y * (size * 4 + 1) + 1 + x * 4)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
await mkdir('build', { recursive: true })
const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = sizes.map(png)
const directory = Buffer.alloc(6 + 16 * sizes.length)
directory.writeUInt16LE(1, 2)
directory.writeUInt16LE(sizes.length, 4)
let offset = directory.length
sizes.forEach((size, index) => {
  const entry = 6 + 16 * index
  directory[entry] = size % 256
  directory[entry + 1] = size % 256
  directory.writeUInt16LE(1, entry + 4)
  directory.writeUInt16LE(32, entry + 6)
  directory.writeUInt32LE(images[index]!.length, entry + 8)
  directory.writeUInt32LE(offset, entry + 12)
  offset += images[index]!.length
})
await writeFile('build/icon.ico', Buffer.concat([directory, ...images]))
await writeFile('build/icon.png', images.at(-1)!)
