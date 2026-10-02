#!/usr/bin/env node
// Gates the CircleCI deploy job's publish and GitHub Releases steps. Packages
// are only released from the maintainer's "version packages" merge, which
// consumes every changeset. While `.changeset/` still holds changesets, master
// carries unreleased work (and possibly versions such as a new package's
// 0.0.0 that must never be published), so publishing is skipped.
//
// Counts the files `changeset version` consumes: top-level `.changeset/*.md`,
// except README.md and the agent instruction files that @changesets/read
// ignores, and dotfiles. Changesets moved to `.changeset/pre/` in pre mode have
// already been versioned, so they don't count.
//
// Exits 0 when nothing is pending, PENDING_EXIT_CODE when changesets are
// pending, and 1 on any other error, so a crash never looks like a skip.
// Usage: node .circleci/pending-changesets.mjs [changeset-dir]

import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const PENDING_EXIT_CODE = 3
const DEFAULT_CHANGESET_DIR = fileURLToPath(
  new URL('../.changeset/', import.meta.url)
)
const IGNORED_FILES = [/^README\.md$/i, /^(AGENTS|CLAUDE|GEMINI)\.md$/]

const main = async () => {
  const changesetDir = process.argv[2] || DEFAULT_CHANGESET_DIR
  const entries = await readdir(changesetDir, { withFileTypes: true })
  const pending = entries
    .filter(
      entry =>
        entry.isFile() &&
        entry.name.endsWith('.md') &&
        !entry.name.startsWith('.') &&
        !IGNORED_FILES.some(pattern => pattern.test(entry.name))
    )
    .map(entry => entry.name)
    .sort()

  if (!pending.length) {
    console.log('No pending changesets, so versioned packages can be published')
    return
  }
  console.log(
    `${pending.length} pending changeset${pending.length === 1 ? '' : 's'}; skipping publish until they're versioned in a "version packages" PR (see CONTRIBUTING.md):`
  )
  for (const file of pending) {
    console.log(`  ${file}`)
  }
  process.exitCode = PENDING_EXIT_CODE
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
