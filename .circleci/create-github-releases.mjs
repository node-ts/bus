#!/usr/bin/env node
// Creates a GitHub Release (and its `<package>@<version>` tag) for each
// published package whose current version has a CHANGELOG entry but no
// release yet. It runs in the CircleCI deploy job after `changeset publish`. Because it
// compares against the releases that already exist, a failed run is fixed by
// re-running the job. Versions published before changesets have no CHANGELOG
// entry, so they are skipped.
//
// Env: GITHUB_TOKEN (contents: write on the repo), CIRCLE_SHA1 (tag target),
// GITHUB_REPOSITORY (optional, defaults to node-ts/bus).
// Pass --dry-run to print the releases without creating them.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGES_DIR = fileURLToPath(new URL('../packages/', import.meta.url))
const REPOSITORY = process.env.GITHUB_REPOSITORY || 'node-ts/bus'
const LATEST_PACKAGE = '@node-ts/bus-core'
const API = `https://api.github.com/repos/${REPOSITORY}`
const dryRun = process.argv.includes('--dry-run')

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Returns the body of the `## <version>` section of a changesets CHANGELOG,
 * or undefined when there is no such section.
 */
const changelogSection = (changelog, version) => {
  const heading = new RegExp(`^## ${escapeRegExp(version)}\\s*$`, 'm')
  const match = heading.exec(changelog)
  if (!match) {
    return undefined
  }
  const rest = changelog.slice(match.index + match[0].length)
  const next = rest.search(/^## /m)
  return (next === -1 ? rest : rest.slice(0, next)).trim()
}

const readCandidates = async () => {
  const candidates = []
  for (const dir of await readdir(PACKAGES_DIR)) {
    let packageJson
    try {
      packageJson = JSON.parse(
        await readFile(join(PACKAGES_DIR, dir, 'package.json'), 'utf8')
      )
    } catch {
      continue
    }
    if (packageJson.private) {
      continue
    }
    let changelog
    try {
      changelog = await readFile(
        join(PACKAGES_DIR, dir, 'CHANGELOG.md'),
        'utf8'
      )
    } catch {
      continue
    }
    const notes = changelogSection(changelog, packageJson.version)
    if (notes !== undefined) {
      candidates.push({
        name: packageJson.name,
        version: packageJson.version,
        tag: `${packageJson.name}@${packageJson.version}`,
        notes
      })
    }
  }
  return candidates
}

const github = async (path, init = {}) => {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      ...(process.env.GITHUB_TOKEN && {
        authorization: `Bearer ${process.env.GITHUB_TOKEN}`
      }),
      'x-github-api-version': '2022-11-28',
      ...init.headers
    }
  })
  if (response.status === 404) {
    return undefined
  }
  if (!response.ok) {
    throw new Error(
      `GitHub API ${init.method || 'GET'} ${path} failed with ${response.status}: ${await response.text()}`
    )
  }
  return response.json()
}

const main = async () => {
  const candidates = await readCandidates()
  if (!candidates.length) {
    console.log('No package versions with CHANGELOG entries to release')
    return
  }
  if (!dryRun && !process.env.GITHUB_TOKEN) {
    throw new Error(
      'GITHUB_TOKEN is not set. Add it to the CircleCI project (see CONTRIBUTING.md) so GitHub Releases can be created.'
    )
  }
  if (!dryRun && !process.env.CIRCLE_SHA1) {
    throw new Error('CIRCLE_SHA1 is not set, so there is no commit to tag')
  }

  for (const { name, tag, notes } of candidates) {
    const existing = await github(`/releases/tags/${encodeURIComponent(tag)}`)
    if (existing) {
      continue
    }
    if (dryRun) {
      console.log(`Would create release ${tag}:\n${notes}\n`)
      continue
    }
    await github('/releases', {
      method: 'POST',
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: process.env.CIRCLE_SHA1,
        name: tag,
        body: notes,
        make_latest: name === LATEST_PACKAGE ? 'true' : 'false'
      })
    })
    console.log(`Created release ${tag}`)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
