# Contributing

Thanks for helping with `@node-ts/bus`. This file covers setting up the repo, proposing a change, the rules every contribution follows, and how releases work. [CLAUDE.md](./CLAUDE.md) has the detailed code conventions and architecture notes, for people and coding agents alike.

- **Questions and ideas** go in [Discussions](https://github.com/node-ts/bus/discussions). Anyone can answer there, but no one is committed to replying.
- **Bugs and feature requests** go in [issues](https://github.com/node-ts/bus/issues/new/choose), using the forms.
- **Security vulnerabilities** are reported privately, as described in [SECURITY.md](./SECURITY.md). Never put them in a public issue.
- Everyone taking part follows the [code of conduct](./CODE_OF_CONDUCT.md).

## Getting started

You need:

- Node.js 24.11.1, the version in `.nvmrc` (`nvm use`).
- pnpm 12.4.1, the version in `packageManager`. `corepack enable` installs it. npm and yarn are rejected by the `preinstall` script.
- Docker with Compose, for the integration tests.

```sh
git clone https://github.com/node-ts/bus.git
cd bus
pnpm i
pnpm build
pnpm test:unit
```

Every package's `main` is its built `dist/index.js`, so packages import each other's build output, not their source. After changing a package that others use (usually bus-core), run `pnpm build` again, or keep `pnpm build:watch` running.

| Script                     | What it does                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm build`               | Compiles every package to its `dist/`                                                       |
| `pnpm build:watch`         | Rebuilds on change                                                                          |
| `pnpm test:unit`           | Runs the `*.spec.ts` unit tests                                                             |
| `pnpm test:integration`    | Runs every `*.integration.ts` against the local infrastructure (see below)                  |
| `pnpm test`                | Runs both, with coverage                                                                    |
| `pnpm lint`                | Runs ESLint with type information (build first, since cross-package types come from `dist`) |
| `pnpm format`              | Formats with prettier. CI runs `pnpm format:check`                                          |
| `pnpm check:packages`      | After a build, packs each package and checks its exports with publint and attw              |
| `pnpm check:message-types` | After a build, fails if a committed `message-types.generated.ts` is out of date             |

To run a single file or test, go through `dotenv` so `test.env` is loaded:

```sh
pnpm exec dotenv -e test.env -- jest packages/bus-core/src/service-bus/bus-instance.integration.ts
pnpm exec dotenv -e test.env -- jest packages/bus-sqs/src/sqs-transport.spec.ts -t "some test name"
```

pnpm fails the install when a dependency has a build script that `allowBuilds` in `pnpm-workspace.yaml` neither approves nor denies. If you add such a dependency, add it there.

## Local infrastructure

The adapter integration tests need real brokers and databases. `docker-compose.yml` at the root starts them all:

```sh
docker compose up -d     # start
pnpm test:integration
docker compose down      # stop
```

| Service    | Image                     | Port                       | Used by                 |
| ---------- | ------------------------- | -------------------------- | ----------------------- |
| RabbitMQ   | `rabbitmq:3-management`   | 5672 (management UI 15672) | bus-rabbitmq            |
| LocalStack | `localstack/localstack:3` | 4566 (SQS, SNS, IAM, STS)  | bus-sqs, bus-sqs-lambda |
| PostgreSQL | `postgres:16`             | 6432 (password `password`) | bus-postgres            |
| MongoDB    | `mongo:7`                 | 27017                      | bus-mongodb             |

Each integration test defaults to these ports. To point at services somewhere else, set the variables listed in `test.env` (`LOCALSTACK_ENDPOINT`, `RABBITMQ_URL`, `POSTGRES_URL`, `MONGODB_URL` and so on). `test.env` also sets dummy AWS credentials for LocalStack. You only need the services for the packages you're testing, for example `docker compose up -d postgres`. CI runs the same integration tests against its own copies of these services.

## Proposing a change

1. **Start with an issue or Discussion** for a new feature or an API change, so the design can be agreed against the [design principles](#design-principles) before you write code. Small fixes can go straight to a PR. Issues labelled [`good first issue`](https://github.com/node-ts/bus/labels/good%20first%20issue) are a good place to start.
2. **Roadmap issues** (labelled `roadmap`, in a `Phase N` milestone, overview in [#271](https://github.com/node-ts/bus/issues/271)) are worked on in milestone order, and an issue isn't started while it's blocked by another open issue. The `Dependency gate` check fails a PR that breaks either rule.
3. **Branch from `master`, one issue per PR.** Fill in the [PR template](./.github/pull_request_template.md): `Closes #N`, then the Summary, Background, Problem and Approach sections, which the `Dependency gate` check requires. A PR with no linked issue needs the `no-issue` label, which the maintainer adds.
4. **Before you push**, run `pnpm build`, `pnpm lint`, `pnpm format:check` and the tests for the packages you changed. Husky and lint-staged format and lint staged files on commit.
5. **Add tests** for every change: `*.spec.ts` for unit tests and `*.integration.ts` for tests that build a real bus or use real infrastructure, next to the code they test. A new transport must pass bus-test's `transportTests` suite, and a new persistence must pass `workflowStateRoundTripTests`. The test conventions are in [CLAUDE.md](./CLAUDE.md#tests).
6. **Add a changeset** if a published package changes in a way users can see (see [Changesets](#changesets)).
7. **Write short, lowercase, imperative commit subjects**, such as `fix rabbitmq reconnect after channel close`. PRs are squash-merged, and the PR title becomes the commit subject.

The maintainer reviews every PR before it merges. Reviews happen as time allows, with no guaranteed response time.

There's no CLA and no DCO sign-off. PR review is the gate. Under [GitHub's terms of service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#6-contributions-under-repository-license), what you contribute is licensed under this repo's [MIT licence](./LICENSE).

## Clean-room contributions

Contributions must be your original work.

- Don't port, translate or copy code, documentation or samples from other messaging frameworks.
- In particular, NServiceBus is licensed under the Reciprocal Public License (RPL) 1.5 plus a commercial licence. Don't consult its source code while implementing features here.
- Implement from public pattern literature and observed behaviour only. That includes [Enterprise Integration Patterns](https://www.enterpriseintegrationpatterns.com/), the original saga paper (Garcia-Molina and Salem, _Sagas_, 1987), and public write-ups of the outbox and inbox patterns.

If you're unsure whether a source is acceptable, ask in the issue before you start writing code.

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
