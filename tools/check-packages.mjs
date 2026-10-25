// Checks what each published package ships. Run after `pnpm build`.
//
// For every package with an `exports` map it:
// - checks the ESM entry (dist/index.mjs) exposes the same values as the CJS
//   build (dist/index.js). The ESM entry re-exports the CJS build, so a missing
//   or different export means Node couldn't detect it in the CJS output.
// - packs the package and runs publint and arethetypeswrong on the tarball.
//
// A published package with no `exports`, such as a command line like
// create-bus-app, is packed and checked with publint only.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = join(import.meta.dirname, '..')
const PACKAGES_DIR = join(ROOT, 'packages')
const BIN = join(ROOT, 'node_modules', '.bin')

const require = createRequire(import.meta.url)
const packDir = mkdtempSync(join(tmpdir(), 'node-ts-bus-pack-'))
const failures = []

const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' })

const checkEsmMatchesCjs = async (name, dir) => {
  const cjs = require(join(dir, 'dist', 'index.js'))
  const esm = await import(pathToFileURL(join(dir, 'dist', 'index.mjs')).href)
  const keys = Object.keys(cjs).filter(key => key !== 'default')
  const mismatched = keys.filter(key => esm[key] !== cjs[key])
  if (mismatched.length) {
    failures.push(`${name}: ESM entry is missing ${mismatched.join(', ')}`)
  }
}

const checkTarball = (name, dir, tools) => {
  const before = new Set(readdirSync(packDir))
  run('pnpm', ['pack', '--pack-destination', packDir], dir)
  const tarball = readdirSync(packDir).find(file => !before.has(file))
  const tarballPath = join(packDir, tarball)
  const checks = {
    publint: ['run', tarballPath, '--strict'],
    attw: ['--pack', tarballPath, '--format', 'ascii']
  }
  for (const tool of tools) {
    const args = checks[tool]
    try {
      run(join(BIN, tool), args, dir)
    } catch (error) {
      failures.push(`${name}: ${tool} failed\n${error.stdout}${error.stderr}`)
    }
  }
}

try {
  for (const entry of readdirSync(PACKAGES_DIR)) {
    const dir = join(PACKAGES_DIR, entry)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    if (manifest.private) {
      continue
    }
    if (manifest.exports) {
      await checkEsmMatchesCjs(manifest.name, dir)
      checkTarball(manifest.name, dir, ['publint', 'attw'])
    } else {
      checkTarball(manifest.name, dir, ['publint'])
    }
    console.log(`Checked ${manifest.name}`)
  }
} finally {
  rmSync(packDir, { recursive: true, force: true })
}

if (failures.length) {
  console.error(failures.join('\n\n'))
  process.exit(1)
}
