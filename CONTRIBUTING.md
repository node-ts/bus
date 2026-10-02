# Contributing

`@node-ts/bus` is maintained in spare time. Issues and PRs may not get a response, and there's no support. For a large change, open an issue before you write the PR.

Report security vulnerabilities privately, as described in [SECURITY.md](./SECURITY.md).

## Setup

You need Node.js 24.11.1 (`.nvmrc`), pnpm 12.4.1 (`packageManager`; `corepack enable` installs it) and Docker with Compose.

```sh
pnpm i
pnpm build
pnpm test:unit
```

Packages import each other's built `dist/`, so run `pnpm build` again after changing one that others use, or keep `pnpm build:watch` running. Run `pnpm lint` and `pnpm format:check` before you push. Code conventions are in [CLAUDE.md](./CLAUDE.md).

## Tests and local infrastructure

`*.spec.ts` files are unit tests, and `*.integration.ts` files use a real bus or real infrastructure. The integration tests need the brokers and databases in `docker-compose.yml`:

```sh
docker compose up -d
pnpm test:integration
```

To run one file, go through `dotenv` so `test.env` is loaded: `pnpm exec dotenv -e test.env -- jest <path>`. Each test defaults to the compose ports. Override them with the variables listed in `test.env`.

## Pull requests

Fill in the [PR template](./.github/pull_request_template.md). The `Dependency gate` check needs `Closes #N` and the Summary, Background, Problem and Approach sections. A PR with no linked issue needs the `no-issue` label. Add a [changeset](#changesets) if a published package changes in a way users can see.

## Clean-room contributions

Contributions must be your original work.

- Don't port, translate or copy code, documentation or samples from other messaging frameworks.
- In particular, NServiceBus is licensed under RPL 1.5 plus a commercial licence. Don't consult its source while implementing features here.
- Implement from public pattern literature (Enterprise Integration Patterns, the original saga paper, outbox/inbox write-ups) and observed behaviour only.

## Design principles

Every API and change should follow these. When a design conflicts with one, change the design or raise it in the issue first.

1. **Functions first, classes optional.**
   Every capability works with plain functions; classes are an equivalent alternative.
   Rules out: features that only work through a base class, decorator or `implements`.
2. **DI is an adapter, not a requirement.**
   Dependencies reach handlers through closures or the handler context; `withContainer` only resolves classes.
   Rules out: requiring a container, or capturing the bus in a module global, to send or publish from a handler.
3. **No hidden process-wide state.**
   Per-message state belongs to its bus, and global defaults can be overridden per bus.
   Rules out: one bus's handling context, correlation or registry leaking into another bus in the same process.
4. **If it compiles, it works.**
   Handler names, state keys and attributes are type-checked to match what happens at runtime.
   Rules out: `any`, string names that aren't checked, and types that accept code which then fails at startup.
5. **Handlers are testable as plain functions.**
   Call a handler directly with a fake context; no bus or mocking framework is needed.
   Rules out: handlers that can only be exercised through a running bus or with `as any`.
6. **Errors say what failed and how to fix it.**
   Every error names the class or message involved and the remedy.
   Rules out: plain `new Error(...)`, generic messages, and errors that hide their cause.

## Changesets

Versions and changelogs are managed with [changesets](https://changesets.dev). **Every PR that changes a published package in a way users can see adds a changeset.** That includes fixes, features, dependency changes that reach consumers, and breaking changes. PRs that only touch tests, CI, docs or internal tooling don't need one.

```sh
pnpm changeset
```

Pick the packages you changed and the bump type for each, then write a sentence or two for the changelog. This adds a markdown file to `.changeset/`. Commit it with the PR. You can edit it by hand afterwards.

- **patch**: bug fixes.
- **minor**: new features and API changes, including breaking ones.
- **Never `major`.** During the roadmap, breaking changes ship as `minor` or `patch` (see [Versioning and support](#versioning-and-support)).

Write the summary for someone upgrading: what changed, what they need to do, and the PR or issue number. Start a breaking change with `**Breaking:**` and add its upgrade steps to [MIGRATING.md](./MIGRATING.md).

**PRs never bump versions.** Don't edit `version` fields, and don't run `pnpm changeset version`. The maintainer does that when cutting a release.

## Releases (maintainers)

1. On a branch from `master`, run:

   ```sh
   pnpm changeset status --verbose   # check the planned bumps
   pnpm changeset version
   ```

   This consumes the pending changesets, bumps each affected package's `version`, and updates its `CHANGELOG.md`. When a new version falls outside a range another package declares on it (for example a bus-core major and the adapters' `^2.0.0` peer range), the range is raised and that package gets at least a patch bump. `workspace:^` ranges are left alone and resolved at publish time.

2. Review the diff, then open a PR titled `version packages` with the `no-issue` label (the description still needs the template's sections), and merge it.
3. On `master`, the CircleCI `deploy` job then:
   - checks `NPM_TOKEN` with `npm whoami`, on every deploy, so an expired token fails the job even when there's nothing to publish,
   - runs `pnpm changeset publish`, which publishes every package whose version isn't on npm yet (`workspace:^` ranges are replaced with the real versions at publish time), and
   - runs `.circleci/create-github-releases.mjs`, which creates a GitHub Release and a `<package>@<version>` tag for each published version, with that version's CHANGELOG section as the notes.

**Publishing is gated on pending changesets.** While `.changeset/` holds any changeset (a `.md` file other than `README.md`), `.circleci/pending-changesets.mjs` lists them and the job stops successfully before publishing or creating releases. So only the `version packages` merge, which consumes them all, publishes anything, and versions that aren't ready (such as a new package's `0.0.0`) never reach npm. Pushes to `master` that don't bump a version publish nothing either. If the publish or releases step fails, re-run the deploy job for the `version packages` commit (a later merge that adds a changeset won't publish): publishing skips versions already on npm, and the releases step only creates releases that don't exist yet.

Packages are released only when they (or something they depend on) change, and their versions are **linked** (`linked` in `.changeset/config.json`). Packages released together get the same version: the highest bump in the release, applied to the highest current version. For example, if bus-core is bumped minor and bus-sqs patch in the same release, both become 2.1.0, while untouched packages stay where they are. That keeps the family's versions readable without republishing unchanged packages.

### CircleCI environment variables

Set these in the CircleCI project settings (Project Settings → Environment Variables):

- `NPM_TOKEN`: an npm **granular access token** with **Read and write** permission on the `@node-ts` scope (select the scope, not individual packages, so it covers every package in it and can create new ones such as `@node-ts/bus-cli`). Enable **Bypass two-factor authentication** so CI can publish without an interactive 2FA prompt. Write tokens have an expiry date (npm caps it, 90 days at the time of writing): note it and replace the token before it lapses. The deploy job's `npm whoami` check fails once it has.
- `GITHUB_TOKEN`: a fine-grained GitHub personal access token with access to `node-ts/bus` only and the **Contents: Read and write** permission. It's used to create the releases and tags.

## Versioning and support

- During the roadmap, breaking changes are allowed and ship in `minor` or `patch` releases, never a new major. Releases go out quickly, before users upgrade. Each one is called out with `**Breaking:**` in the changelog, with upgrade steps in [MIGRATING.md](./MIGRATING.md). Make the change directly: no deprecation shims or compatibility flags.
- The supported Node.js versions are those in each package's `engines.node`, currently Node.js 24 or later. Raising the minimum is a breaking change, handled as above.
- Adapters declare `@node-ts/bus-core` as a peer dependency (`^2.0.0`). A bus-core major raises those ranges when it's versioned, so it's released together with a major of each adapter. Minor and patch releases of bus-core leave the peer ranges alone (`onlyUpdatePeerDependentsWhenOutOfRange`).
