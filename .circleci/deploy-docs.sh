#!/usr/bin/env bash
# Uploads the built docs (docs/.vitepress/dist) to Cloudflare Pages with
# wrangler. Run it after `pnpm docs:build`.
#
#   .circleci/deploy-docs.sh next        # the next.<project>.pages.dev alias
#   .circleci/deploy-docs.sh production  # bus.node-ts.com
#
# Env: CLOUDFLARE_API_TOKEN (Cloudflare Pages: Edit), CLOUDFLARE_ACCOUNT_ID,
# CLOUDFLARE_PAGES_PROJECT (optional, defaults to node-ts-bus). See the Docs
# section of CONTRIBUTING.md.
set -euo pipefail

BRANCH="${1:?Usage: deploy-docs.sh <next|production>}"
PROJECT="${CLOUDFLARE_PAGES_PROJECT:-node-ts-bus}"
# Run with npx rather than installed with the workspace, since wrangler pulls
# in workerd and sharp, which have install scripts
WRANGLER="wrangler@4.147.0"
DIST="docs/.vitepress/dist"

missing=()
for name in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do
  if [ -z "${!name:-}" ]; then
    missing+=("$name")
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "Can't deploy the docs: these environment variables aren't set: ${missing[*]}" >&2
  echo "Add them in CircleCI under Project Settings > Environment Variables, as described in the Docs section of CONTRIBUTING.md." >&2
  exit 1
fi

if [ ! -f "$DIST/index.html" ]; then
  echo "Can't deploy the docs: $DIST/index.html doesn't exist. Run \`pnpm docs:build\` first." >&2
  exit 1
fi

npx --yes "$WRANGLER" pages deploy "$DIST" \
  --project-name="$PROJECT" \
  --branch="$BRANCH" \
  --commit-hash="${CIRCLE_SHA1:-$(git rev-parse HEAD)}" \
  --commit-dirty=true
