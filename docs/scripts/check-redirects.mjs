// @ts-check
// Checks that the URLs of the old sites still lead somewhere useful on the new
// one. Run it after `docs:build`.
//
// GitHub Pages can't send redirects, so the build writes a stub page at each
// old path in docs/redirects.json that sends the browser on (a meta refresh,
// with a canonical link and a visible link). bus.node-ts.com redirects to the
// same path under https://node-ts.github.io/bus, so the old GitBook URLs land
// on these stubs too.
//
// Each path is resolved the way GitHub Pages serves the build output: `/a/`
// serves `a/index.html`, and `/a` serves the file `a`, then `a.html`, then
// `a/index.html`.
//
// - Every URL in the GitBook sitemap (scripts/gitbook-sitemap.xml), `/master`
//   and their `.md` exports must be a page, or a stub that leads to one.
// - Every page of the legacy GitHub Pages site (scripts/legacy-site-paths.txt)
//   must be a page, a stub that leads to one, or fall through to a 404 page
//   that links home.
// - Every stub must lead to a page, not to another stub or nothing.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DOCS = join(import.meta.dirname, '..')
const DIST = join(DOCS, '.vitepress', 'dist')
const SITE_URL = 'https://node-ts.github.io/bus'
const OLD_ORIGIN = 'https://bus.node-ts.com'

const isFile = path => existsSync(path) && statSync(path).isFile()

/**
 * @param {string} path a path under the site's base, such as `/guide/messages`
 * @returns {string | undefined} the file GitHub Pages serves for it, if any
 */
const resolve = path => {
  const file = join(DIST, decodeURIComponent(path))
  const candidates = path.endsWith('/')
    ? [join(file, 'index.html')]
    : [file, `${file}.html`, join(file, 'index.html')]
  return candidates.find(isFile)
}

/**
 * @param {string} file
 * @returns {string | undefined} where a redirect stub sends the browser, or undefined if the file isn't one
 */
const stubTarget = file => {
  const content = readFileSync(file, 'utf8')
  if (file.endsWith('.md')) {
    return /^# This page has moved/.test(content)
      ? /It's now at (\S+?)\.?(\s|$)/.exec(content)?.[1]
      : undefined
  }
  const refresh = /<meta http-equiv="refresh" content="0; url=([^"]+)"/.exec(
    content
  )?.[1]
  if (refresh) {
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(content)?.[1]
    if (canonical !== refresh) {
      throw new Error(
        `${file} redirects to ${refresh} but its canonical link is ${canonical}`
      )
    }
  }
  return refresh
}

/**
 * @param {string} url a URL on the site
 * @returns {string | undefined} its path under the site's base
 */
const sitePath = url =>
  url === SITE_URL || url.startsWith(`${SITE_URL}/`)
    ? url.slice(SITE_URL.length) || '/'
    : undefined

/**
 * Follows a path to the page it ends on
 * @param {string} path
 * @returns {{ page?: string, stub?: string, problem?: string }}
 */
const follow = path => {
  const file = resolve(path)
  if (!file) {
    return {}
  }
  const target = stubTarget(file)
  if (target === undefined) {
    return { page: path }
  }
  const targetPath = sitePath(target)
  if (targetPath === undefined) {
    return { stub: target, problem: `leads off the site, to ${target}` }
  }
  const targetFile = resolve(targetPath)
  if (!targetFile) {
    return { stub: target, problem: `leads to ${target}, which isn't a page` }
  }
  if (stubTarget(targetFile) !== undefined) {
    return {
      stub: target,
      problem: `leads to ${target}, which is another redirect stub`
    }
  }
  return { page: targetPath, stub: target }
}

const lines = file =>
  readFileSync(join(import.meta.dirname, file), 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))

const gitbookPaths = () => {
  const paths = [
    ...readFileSync(
      join(import.meta.dirname, 'gitbook-sitemap.xml'),
      'utf8'
    ).matchAll(/<loc>([^<]+)<\/loc>/g)
  ].map(match => new URL(match[1], OLD_ORIGIN).pathname)
  if (!paths.length) {
    throw new Error('No URLs found in scripts/gitbook-sitemap.xml')
  }
  // GitBook served the home page as /master too, and every page as markdown with .md added
  const markdown = paths.map(path =>
    path === '/' ? '/master.md' : `${path}.md`
  )
  return [...new Set([...paths, '/master', ...markdown])]
}

if (!isFile(join(DIST, 'index.html'))) {
  console.error(
    `${DIST} has no index.html. Run \`pnpm docs:build\` before checking the redirects.`
  )
  process.exit(1)
}

const failures = []

const notFound = join(DIST, '404.html')
if (
  !isFile(notFound) ||
  // VitePress renders the 404 page in the browser, from the notFound config
  !readFileSync(notFound, 'utf8').includes('Go to the home page')
) {
  failures.push(
    "404.html doesn't exist, or doesn't have the notFound text that links home"
  )
}

const redirects = JSON.parse(readFileSync(join(DOCS, 'redirects.json'), 'utf8'))
for (const from of Object.keys({ ...redirects.gitbook, ...redirects.legacy })) {
  const { stub, problem } = follow(from)
  if (!stub) {
    failures.push(
      `${from} is in redirects.json, but the build has no stub there`
    )
  } else if (problem) {
    failures.push(`${from} ${problem}`)
  }
}

const gitbook = gitbookPaths()
for (const path of gitbook) {
  const { page, problem } = follow(path)
  if (problem) {
    failures.push(`${path} from the GitBook site ${problem}`)
  } else if (!page) {
    failures.push(
      `${path} from the GitBook site is neither a page nor a redirect stub. Add it to redirects.json`
    )
  }
}

const legacy = lines('legacy-site-paths.txt')
let legacyNotFound = 0
for (const path of legacy) {
  const { page, problem } = follow(path)
  if (problem) {
    failures.push(`${path} from the legacy site ${problem}`)
  } else if (!page) {
    legacyNotFound++
  }
}

if (failures.length) {
  console.error(`Redirect check failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log(
  `All ${gitbook.length} GitBook URLs lead to a page. Of ${legacy.length} legacy site pages, ${legacy.length - legacyNotFound} lead to a page and ${legacyNotFound} get the 404 page.`
)
