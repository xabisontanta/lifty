import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import QRCode from 'qrcode'

const require = createRequire(import.meta.url)
// Resolve the PNG renderer through the pinned QR package rather than adding a
// second image dependency. Both the QR and the app icons are reproducible.
const { PNG } = require(require.resolve('pngjs', { paths: [require.resolve('qrcode')] }))
const publicDir = fileURLToPath(new URL('../public/', import.meta.url))
const url = new URL(process.argv[2] ?? 'https://lifty-ten.vercel.app/')
if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
  throw new Error('Use a public HTTPS app URL without credentials, a query, or a fragment.')
}
await mkdir(`${publicDir}/icons`, { recursive: true })
await QRCode.toFile(`${publicDir}/review-qr.png`, url.href, {
  width: 512, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#0f2d4aff', light: '#ffffffff' },
})
await writeFile(`${publicDir}/review-qr.json`, `${JSON.stringify({ url: url.href }, null, 2)}\n`)

for (const size of [192, 512]) {
  const png = new PNG({ width: size, height: size })
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let pin = 0
    // Four samples per pixel soften the edges while keeping output deterministic.
    for (const dy of [0.25, 0.75]) for (const dx of [0.25, 0.75]) {
      const px = (x + dx) / size, py = (y + dy) / size
      const circle = (px - 0.5) ** 2 + (py - 0.38) ** 2 <= 0.245 ** 2
      const tail = py >= 0.38 && py <= 0.84 && Math.abs(px - 0.5) <= (0.84 - py) * 0.53
      const hole = (px - 0.5) ** 2 + (py - 0.38) ** 2 < 0.092 ** 2
      if ((circle || tail) && !hole) pin++
    }
    const i = (y * size + x) * 4, amount = pin / 4
    png.data[i] = Math.round(15 * (1 - amount) + 255 * amount)
    png.data[i + 1] = Math.round(45 * (1 - amount) + 255 * amount)
    png.data[i + 2] = Math.round(74 * (1 - amount) + 255 * amount)
    png.data[i + 3] = 255
  }
  await writeFile(`${publicDir}/icons/lifty-${size}.png`, PNG.sync.write(png))
}
console.info(`Generated phone review QR for ${url.href}`)
