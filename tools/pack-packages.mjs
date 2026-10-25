// Packs every published package into a folder, as `pnpm publish` would pack
// them, with `workspace:` ranges replaced. Run after `pnpm build`.
//
//   node tools/pack-packages.mjs <folder>
//
// CI creates apps with create-bus-app that depend on these tarballs (through
// CREATE_BUS_APP_TARBALLS), so they're tested before the packages are
// published.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PACKAGES_DIR = join(ROOT, 'packages')

const [folder] = process.argv.slice(2)
if (!folder) {
  console.error('Usage: node tools/pack-packages.mjs <folder>')
  process.exit(2)
}
const destination = resolve(folder)
mkdirSync(destination, { recursive: true })

for (const entry of readdirSync(PACKAGES_DIR)) {
  const dir = join(PACKAGES_DIR, entry)
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  if (manifest.private) {
    continue
  }
  execFileSync('pnpm', ['pack', '--pack-destination', destination], {
    cwd: dir,
    stdio: 'pipe'
  })
  console.log(`Packed ${manifest.name}@${manifest.version}`)
}
