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

The consumer docs at [node-ts.github.io/bus](https://node-ts.github.io/bus) are built from [`docs/`](./docs) with VitePress. **Docs ship with features: every PR that changes what users see adds or updates its page in the same PR.** A breaking change also updates [MIGRATING.md](./MIGRATING.md), which the site renders at `/upgrading/v2`.

```sh
pnpm build            # the snippets and API reference are built from the packages
pnpm docs:dev         # preview at http://localhost:5173/bus/
pnpm docs:typecheck   # type check the snippets
pnpm docs:build       # fails on a dead internal link or an unresolved {@link}
pnpm docs:check-redirects
```

- Every page follows the template in [docs/README.md](./docs/README.md): frontmatter with a `title` and `description`, a one-paragraph intro, the content, and a "See also" section. Use only the components listed there. A new page goes in the section of the sidebar it belongs to, in `docs/.vitepress/config.mts`.
- Every TypeScript snippet is a file in `docs/snippets`, embedded with `<<< @/snippets/file.ts#region`, so that it's type checked against the packages. Don't write TypeScript inline in a page.
- The API reference (`/api/`) is generated from the packages' JSDoc at build time. A `{@link}` that doesn't resolve fails the build; missing JSDoc is only a warning.
- GitHub Pages can't send redirects, so old URLs keep working through stub pages: the build writes one at each old path in `docs/redirects.json`, which sends the browser on to the new page. When you move or remove a page, add its old path there. Paths with no page and no stub get the 404 page, which links home.

CircleCI's `docs` job runs the type check, the build and the redirect check on every branch, including pull requests.

### Deploying

[`.github/workflows/docs.yml`](./.github/workflows/docs.yml) builds the site and deploys it to GitHub Pages with the workflow's own `GITHUB_TOKEN`, so there are no secrets to set up. It runs:

- **On every GitHub Release**, so the site follows what's on npm. CircleCI's `deploy` job creates the releases with the `GITHUB_TOKEN` personal access token (see [CircleCI environment variables](#circleci-environment-variables)), and releases created with a personal access token trigger workflows. A release of several packages creates several releases; their runs queue, and the last one wins.
- **By hand, for a docs-only fix:** on GitHub, **Actions → Docs → Run workflow**, with **Use workflow from** set to `master`.

To roll back, run the workflow by hand with **Use workflow from** set to the tag of an earlier release, such as `@node-ts/bus-core@2.0.0`.

### Setting up GitHub Pages (maintainers)

Done once:

1. In the repository, **Settings → Pages → Build and deployment → Source**: choose **GitHub Actions**. This creates the `github-pages` environment.
2. **Settings → Environments → github-pages → Deployment branches and tags**: keep `master`, and click **Add deployment branch or tag rule**, with **Ref type** `Tag` and **Name pattern** `@node-ts/*`. Without it, the runs that releases trigger can't deploy, since they run on the release's tag.
3. Run the workflow by hand (above), and check the site at `https://node-ts.github.io/bus/`, including a few old URLs such as `https://node-ts.github.io/bus/installing/installation` and `https://node-ts.github.io/bus/guide/transports/rabbitmq`.

### Moving bus.node-ts.com to the new site (maintainers)

`bus.node-ts.com` is a CNAME to `hosting.gitbook.io` in the `node-ts.com` Cloudflare zone. Until the domain lapses on 2027-10-27, a Cloudflare redirect rule sends every old URL to the same path on the new site, where the redirect stubs send it on to its page: `bus.node-ts.com/installing/installation` → `node-ts.github.io/bus/installing/installation` → `node-ts.github.io/bus/getting-started/installation`.

1. Set up GitHub Pages (above).
2. In the Cloudflare dashboard, open the `node-ts.com` zone, then **DNS → Records**. Delete the `bus` CNAME and **Add record**: **Type** `AAAA`, **Name** `bus`, **IPv6 address** `100::`, **Proxy status** Proxied. A redirect rule only runs on proxied records, and the address is a placeholder, since every request is redirected.
3. Still in the zone, **Rules → Redirect Rules → Create rule**:
   - **Rule name**: `bus.node-ts.com to GitHub Pages`
   - **If incoming requests match**: Custom filter expression, **Field** `Hostname`, **Operator** `equals`, **Value** `bus.node-ts.com`
   - **Then**: **Type** `Dynamic`, **Expression** `concat("https://node-ts.github.io/bus", http.request.uri.path)`, **Status code** `301`, **Preserve query string** on
   - **Deploy**
4. Check that `https://bus.node-ts.com/installing/installation` ends on `https://node-ts.github.io/bus/getting-started/installation`, and `https://bus.node-ts.com/` on the home page.
5. In GitBook, remove the custom domain from the space, so it's served at `https://node-ts.gitbook.io/bus`. Then freeze the space: leave it published as the unmaintained 1.x docs, which `/upgrading/v2` links to, and stop editing it.
6. In Google Search Console, **Add property → URL prefix** `https://node-ts.github.io/bus/`. The legacy site's verification file is still deployed (`docs/public/google54b7168c649f74a6.html`), so the HTML file method should verify it. Then **Sitemaps → Add a new sitemap** `https://node-ts.github.io/bus/sitemap.xml`.

**Rolling back:** delete the redirect rule, put the `bus` record back as a CNAME to `hosting.gitbook.io` with **Proxy status** DNS only, and add `bus.node-ts.com` as the custom domain of the GitBook space again.

When the domain lapses, the redirect stops, and links to bus.node-ts.com stop working. Everything in this repository links to node-ts.github.io/bus.

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
