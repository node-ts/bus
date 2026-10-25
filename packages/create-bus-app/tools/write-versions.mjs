// Writes dist/versions.json, the version of every published @node-ts package in
// the workspace, when the package is built. The scaffolder turns the
// template's `workspace:^` dependencies into `^<version>` with it, so a
// released create-bus-app creates apps on the packages released with it.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PACKAGE_DIR = join(import.meta.dirname, '..')
const PACKAGES_DIR = join(PACKAGE_DIR, '..')

const versions = {}
for (const entry of readdirSync(PACKAGES_DIR).sort()) {
  const file = join(PACKAGES_DIR, entry, 'package.json')
  if (!existsSync(file)) {
    continue
  }
  const {
    name,
    version,
    private: isPrivate
  } = JSON.parse(readFileSync(file, 'utf8'))
  if (name.startsWith('@node-ts/') && !isPrivate) {
    versions[name] = version
  }
}

writeFileSync(
  join(PACKAGE_DIR, 'dist', 'versions.json'),
  `${JSON.stringify(versions, null, 2)}\n`
)
