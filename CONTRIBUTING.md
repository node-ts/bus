# Contributing

Setup, scripts and local infrastructure are covered in the [README](./README.md#development) and [CLAUDE.md](./CLAUDE.md). This file covers the design principles, changesets and releases.

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

## Docs

The consumer docs at [bus.node-ts.com](https://bus.node-ts.com) are built from [`docs/`](./docs) with VitePress. **Docs ship with features: every PR that changes what users see adds or updates its page in the same PR.** A breaking change also updates [MIGRATING.md](./MIGRATING.md), which the site renders at `/upgrading/v2`.

```sh
pnpm build            # the snippets and API reference are built from the packages
pnpm docs:dev         # preview at http://localhost:5173
pnpm docs:typecheck   # type check the snippets
pnpm docs:build       # fails on a dead internal link or an unresolved {@link}
pnpm docs:check-redirects
```

- Every page follows the template in [docs/README.md](./docs/README.md): frontmatter with a `title` and `description`, a one-paragraph intro, the content, and a "See also" section. Use only the components listed there. A new page goes in the section of the sidebar it belongs to, in `docs/.vitepress/config.mts`.
- Every TypeScript snippet is a file in `docs/snippets`, embedded with `<<< @/snippets/file.ts#region`, so that it's type checked against the packages. Don't write TypeScript inline in a page.
- The API reference (`/api/`) is generated from the packages' JSDoc at build time. A `{@link}` that doesn't resolve fails the build; missing JSDoc is only a warning.
- Old URLs keep working through `docs/public/_redirects`. When you move or remove a page, add a 301 from its old path.

### Deploying

The site is hosted on Cloudflare Pages, and CircleCI uploads it with `wrangler pages deploy` ([.circleci/deploy-docs.sh](./.circleci/deploy-docs.sh)):

- Every push to `master` deploys to the `next` alias, `https://next.<project>.pages.dev`.
- Production deploys from the `deploy` job when `changeset publish` has published at least one package, so the site matches the latest release.
- For a docs-only fix, trigger a pipeline on `master` with the `deploy-docs` parameter set to `true` (in CircleCI, **Trigger Pipeline**, then add the boolean parameter). This also re-deploys production if its step failed after a publish, since a re-run finds nothing new to publish.

PRs aren't deployed; build them locally with `pnpm docs:build` and `pnpm docs:preview`.

Set these in the CircleCI project settings (Project Settings → Environment Variables). The deploy steps fail, saying which is missing, until they're set:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with only the **Account → Cloudflare Pages → Edit** permission, for the account that has the Pages project.
- `CLOUDFLARE_ACCOUNT_ID`: that account's id.
- `CLOUDFLARE_PAGES_PROJECT` (optional): the Pages project's name, if it isn't `node-ts-bus`.
- `CLOUDFLARE_WEB_ANALYTICS_TOKEN` (optional): the site token of a Cloudflare Web Analytics site, which the build adds as the cookieless analytics beacon. Leave it unset if Web Analytics is turned on in the Pages project's settings instead, which adds the beacon itself.

### Setting up hosting (maintainers)

Done once:

1. Create the Pages project as a direct upload project, with `production` as its production branch: `npx wrangler pages project create node-ts-bus --production-branch production`, or in the dashboard under **Workers & Pages → Create → Pages → Upload assets**.
2. Create the API token and add the environment variables above.
3. Turn on Web Analytics, either in the Pages project (**Metrics → Web Analytics**) or as a site under **Analytics & Logs → Web Analytics** with its token in `CLOUDFLARE_WEB_ANALYTICS_TOKEN`.
4. Trigger a pipeline on `master` with `deploy-docs` set, and check the site at `https://node-ts-bus.pages.dev`, including a few old URLs such as `/installing/installation` and `/guide/transports/rabbitmq`.

### Switching bus.node-ts.com to Cloudflare Pages (maintainers)

`bus.node-ts.com` is a CNAME to `hosting.gitbook.io` in the `node-ts.com` Cloudflare zone.

1. Check the `pages.dev` deploy, as above.
2. In GitBook, remove the custom domain from the space, so that it's served at `https://node-ts.gitbook.io/bus`.
3. In the Pages project, add `bus.node-ts.com` under **Custom domains**. Cloudflare replaces the CNAME with one to the project.
4. Check that `https://bus.node-ts.com` serves the new site over HTTPS, and that the old URLs redirect (`pnpm docs:check-redirects` checks the build, not the live site).
5. Submit `https://bus.node-ts.com/sitemap.xml` in Google Search Console.
6. Freeze the GitBook space: leave it published at `https://node-ts.gitbook.io/bus` as the unmaintained 1.x docs, which `/upgrading/v2` links to, and stop editing it.

**Rolling back:** remove the custom domain from the Pages project, point the `bus` CNAME back to `hosting.gitbook.io` in the `node-ts.com` zone, and add the custom domain to the GitBook space again.

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
