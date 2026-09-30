# Contributing

Setup, scripts and local infrastructure are covered in the [README](./README.md#development) and [CLAUDE.md](./CLAUDE.md). This file covers changesets and releases.

## Changesets

Versions and changelogs are managed with [changesets](https://changesets.dev). **Every PR that changes a published package in a way users can see adds a changeset.** That includes fixes, features, dependency changes that reach consumers, and breaking changes. PRs that only touch tests, CI, docs or internal tooling don't need one.

```sh
pnpm changeset
```

Pick the packages you changed and the bump type for each, then write a sentence or two for the changelog. This adds a markdown file to `.changeset/`. Commit it with the PR. You can edit it by hand afterwards.

- **patch**: bug fixes that don't change the API.
- **minor**: new features, or backwards-compatible API additions.
- **major**: breaking changes. Ask the maintainer before making one, because it can change the bump of other packages (see [Versioning and support](#versioning-and-support)).

Write the summary for someone upgrading: what changed, what they need to do, and the PR or issue number. Start a breaking change with `**Breaking:**`.

**PRs never bump versions.** Don't edit `version` fields, and don't run `pnpm changeset version`. The maintainer does that when cutting a release.

## Releases (maintainers)

1. On a branch from `master`, run:

   ```sh
   pnpm changeset status --verbose   # check the planned bumps
   pnpm changeset version
   ```

   This consumes the pending changesets, bumps each affected package's `version`, and updates its `CHANGELOG.md`. Packages that depend on a bumped package through `dependencies` get a patch bump when their range no longer covers the new version.

2. Review the diff, then open a PR titled `version packages` with the `no-issue` label (the description still needs the template's sections), and merge it.
3. On `master`, the CircleCI `deploy` job then:
   - runs `pnpm changeset publish`, which publishes every package whose version isn't on npm yet (`workspace:^` ranges are replaced with the real versions at publish time), and
   - runs `.circleci/create-github-releases.mjs`, which creates a GitHub Release and a `<package>@<version>` tag for each published version, with that version's CHANGELOG section as the notes.

Pushes to `master` that don't bump a version publish nothing. If the releases step fails after publishing, re-run the job: it only creates releases that don't exist yet.

Packages are versioned independently: each package's version only moves when it (or something it depends on) changes.

### CircleCI environment variables

Set these in the CircleCI project settings (Project Settings → Environment Variables):

- `NPM_TOKEN`: an npm automation token that can publish the `@node-ts` packages.
- `GITHUB_TOKEN`: a fine-grained GitHub personal access token with access to `node-ts/bus` only and the **Contents: Read and write** permission. It's used to create the releases and tags.

## Versioning and support

- Every package follows [semver](https://semver.org).
- The supported Node.js versions are those in each package's `engines.node`, currently Node.js 24 or later. Raising the minimum is called out with `**Breaking:**` in the changelog.
- Adapters declare `@node-ts/bus-core` as a peer dependency, so a bus-core major release also needs a release of each adapter that widens its peer range.
