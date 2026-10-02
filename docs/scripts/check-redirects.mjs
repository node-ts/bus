// @ts-check
// Checks that every URL of the old GitBook site still works on the new one:
// that it's a page of the build, or a 301 to one. Run it after `docs:build`.
//
// It resolves each URL the way Cloudflare Pages serves the build output:
// `_redirects` rules apply first, even where a file exists, then `/a` serves
// `a.html`, `/a/` serves `a/index.html` and other paths serve their file. It
// also checks that every rule in `_redirects` is a 301 to a live page, and
// that no rule hides a page of the build.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DOCS = join(import.meta.dirname, '..')
const DIST = join(DOCS, '.vitepress', 'dist')
const SITEMAP = join(import.meta.dirname, 'gitbook-sitemap.xml')
const OLD_ORIGIN = 'https://bus.node-ts.com'

const isFile = path => existsSync(path) && statSync(path).isFile()

/**
 * @param {string} path a URL path, such as `/guide/messages`
 * @returns {boolean} whether the build has a page or file at the path, which Pages would serve with a 200
 */
const isLive = path => {
  const file = join(DIST, decodeURIComponent(path))
  if (path.endsWith('/')) {
    return isFile(join(file, 'index.html'))
  }
  return isFile(file) || isFile(`${file}.html`)
}

/**
 * @returns {Map<string, { to: string, status: number, line: number }>}
 */
const readRedirects = () => {
  const file = join(DIST, '_redirects')
  if (!isFile(file)) {
    throw new Error(
      `${file} doesn't exist. Run \`pnpm docs:build\` before checking the redirects.`
    )
  }
  const redirects = new Map()
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((text, index) => {
      const line = text.trim()
      if (!line || line.startsWith('#')) {
        return
      }
      const [from, to, status, ...rest] = line.split(/\s+/)
      if (!to || rest.length) {
        throw new Error(
          `_redirects line ${index + 1} should be \`<from> <to> 301\`: ${line}`
        )
      }
      redirects.set(from, {
        to,
        status: Number(status ?? 302),
        line: index + 1
      })
    })
  return redirects
}

/**
 * @returns {string[]} the path of every page in the old sitemap, and of its markdown export
 */
const readOldPaths = () => {
  const urls = [
    ...readFileSync(SITEMAP, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)
  ].map(match => match[1])
  if (!urls.length) {
    throw new Error(`No URLs found in ${SITEMAP}`)
  }
  const paths = urls.map(url => new URL(url, OLD_ORIGIN).pathname)
  // GitBook served the home page as /master too, and every page as markdown with .md added
  const markdown = paths.map(path =>
    path === '/' ? '/master.md' : `${path}.md`
  )
  return [...new Set([...paths, '/master', ...markdown])]
}

const failures = []
const redirects = readRedirects()

for (const [from, { to, status, line }] of redirects) {
  if (status !== 301) {
    failures.push(
      `_redirects line ${line}: ${from} should be a 301, not ${status}`
    )
  }
  if (!isLive(to)) {
    failures.push(
      `_redirects line ${line}: ${from} redirects to ${to}, which isn't a page of the build`
    )
  }
  if (isLive(from)) {
    failures.push(
      `_redirects line ${line}: ${from} is a page of the build, so redirecting it hides the page`
    )
  }
}

const oldPaths = readOldPaths()
for (const path of oldPaths) {
  const redirect = redirects.get(path)
  if (redirect) {
    continue
  }
  if (!isLive(path)) {
    failures.push(
      `${path} from the old site is neither a page of the build nor redirected in _redirects`
    )
  }
}

if (failures.length) {
  console.error(`Redirect check failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log(
  `All ${oldPaths.length} old URLs are pages of the build or 301 to one, and all ${redirects.size} redirects point to live pages.`
)
