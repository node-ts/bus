#!/usr/bin/env node
// Prints the `<name>@<version>` of each published package whose current
// version isn't on npm yet, one per line. The CircleCI deploy job runs it
// before `changeset publish`, so it knows whether the publish released
// anything, and so whether to deploy the docs to production.
//
// A version whose lookup fails for any reason other than a 404 is printed too,
// with a warning on stderr, so a registry outage deploys the docs rather than
// skipping them.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGES_DIR = fileURLToPath(new URL('../packages/', import.meta.url))
const REGISTRY = 'https://registry.npmjs.org'

const readPackages = async () => {
  const packages = []
  for (const dir of await readdir(PACKAGES_DIR)) {
    try {
      const packageJson = JSON.parse(
        await readFile(join(PACKAGES_DIR, dir, 'package.json'), 'utf8')
      )
      if (!packageJson.private) {
        packages.push({ name: packageJson.name, version: packageJson.version })
      }
    } catch {
      // Not a package
    }
  }
  return packages
}

const isPublished = async ({ name, version }) => {
  const url = `${REGISTRY}/${name.replace('/', '%2F')}/${version}`
  try {
    const response = await fetch(url)
    if (response.ok) {
      return true
    }
    if (response.status !== 404) {
      console.warn(`Couldn't check ${name}@${version}: ${response.status}`)
    }
  } catch (error) {
    console.warn(`Couldn't check ${name}@${version}: ${error}`)
  }
  return false
}

for (const pkg of await readPackages()) {
  if (!(await isPublished(pkg))) {
    console.log(`${pkg.name}@${pkg.version}`)
  }
}
