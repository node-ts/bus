// @ts-check
// Keeps the READMEs in step with the docs site. The READMEs are published to
// npm with each package, and their examples come from the same type checked
// files in docs/snippets as the site's.
//
// A README embeds a snippet with a marker comment, followed by a code block
// that this script writes. The path and region follow VitePress' `<<<` syntax:
//
//   <!-- <<< @/snippets/amazon-sqs.ts#configure -->
//
//   ```ts
//   (written by this script)
//   ```
//
// `node scripts/sync-readmes.mjs` rewrites each marked code block from its
// snippet. With `--check` it writes nothing, and fails if a README:
//
// - has a code block that's out of date with its snippet, or a TypeScript code
//   block with no marker
// - links to a page or heading of the site that doesn't exist, to a file in
//   the repository that doesn't exist, or to the old docs sites
// - is a package README with a relative link (npm doesn't resolve them), or
//   that doesn't follow the template in docs/README.md
//
// Links to the API reference (/api/) are checked against the pages typedoc
// generates, so run it after `docs:build` (or `docs:api`).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const DOCS = join(import.meta.dirname, '..')
const ROOT = join(DOCS, '..')
const SNIPPETS = join(DOCS, 'snippets')
const SITE_URL = 'https://node-ts.github.io/bus'
const REPOSITORY_URL = 'https://github.com/node-ts/bus'
const OLD_DOCS = ['https://bus.node-ts.com', 'https://node-ts.gitbook.io']

const check = process.argv.includes('--check')

const MARKER = /^<!-- <<< @\/snippets\/([\w./-]+?)(?:#([\w*-]+))? -->$/
const FENCE = /^(`{3,})(\w*)/
const REGION = /^\/\/ ?#?((?:end)?region) ([\w*-]+)$/

/**
 * The READMEs to sync: the root README and one per package
 * @returns {{ file: string, pkg?: string }[]}
 */
const readmes = () => [
  { file: join(ROOT, 'README.md') },
  ...readdirSync(join(ROOT, 'packages'))
    .filter(pkg => existsSync(join(ROOT, 'packages', pkg, 'README.md')))
    .map(pkg => ({ file: join(ROOT, 'packages', pkg, 'README.md'), pkg }))
]

/**
 * Removes the indentation that every line shares, as VitePress does
 * @param {string[]} lines
 */
const dedent = lines => {
  const indent = Math.min(
    ...lines.filter(l => l.trim()).map(l => l.length - l.trimStart().length)
  )
  return Number.isFinite(indent) ? lines.map(l => l.slice(indent)) : lines
}

/**
 * Reads a snippet, or one region of it, the way VitePress' `<<<` does
 * @param {string} path the path under docs/snippets
 * @param {string | undefined} region
 * @returns {string} the code, with no trailing newline
 */
const readSnippet = (path, region) => {
  const file = join(SNIPPETS, path)
  if (!existsSync(file)) {
    throw new Error(`docs/snippets/${path} doesn't exist`)
  }
  const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
  if (!region) {
    return lines.join('\n').trimEnd()
  }
  const isMarker = (/** @type {string} */ line, /** @type {string} */ tag) => {
    const [, found, name] = REGION.exec(line.trim()) ?? []
    return found === tag && name === region
  }
  const start = lines.findIndex(line => isMarker(line, 'region'))
  const end = lines.findIndex(
    (line, i) => i > start && isMarker(line, 'endregion')
  )
  if (start === -1 || end === -1) {
    throw new Error(`docs/snippets/${path} has no region "${region}"`)
  }
  return dedent(
    lines.slice(start + 1, end).filter(line => !REGION.test(line.trim()))
  )
    .join('\n')
    .trimEnd()
}

/**
 * The anchor VitePress gives a heading: `slugify` from @mdit-vue/shared
 * @param {string} heading
 */
const slugify = heading =>
  heading
    .normalize('NFKD')
    // Combining marks, then control characters
    .replace(/[\u0300-\u036F]/g, '')
    // eslint-disable-next-line no-control-regex -- the same as VitePress
    .replace(/[\u0000-\u001f]/g, '')
    .replace(
      /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'\u201C\u201D\u2018\u2019<>,.?/]+/g,
      '-'
    )
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase()

/**
 * The anchors of a page's headings
 * @param {string} file
 * @returns {Set<string>}
 */
const anchorsOf = file => {
  let content = readFileSync(file, 'utf8')
  // Pages such as upgrading/v2 render another file
  content = content.replace(/<!--@include: (.+?)-->/g, (_, include) =>
    readFileSync(join(dirname(file), include.trim()), 'utf8')
  )
  const anchors = new Set()
  let inFence = false
  for (const line of content.split('\n')) {
    if (FENCE.test(line.trim())) inFence = !inFence
    const heading = !inFence && /^#{1,6} (.+)$/.exec(line)
    if (!heading) continue
    const explicit = /\{#([\w-]+)\}\s*$/.exec(heading[1])
    anchors.add(explicit ? explicit[1] : slugify(heading[1]))
  }
  return anchors
}

/**
 * @param {string} url a link to the site
 * @returns {string | undefined} why it's broken, if it is
 */
const checkSiteLink = url => {
  const [path, anchor] = url.slice(SITE_URL.length).split('#')
  const page = path.replace(/^\/|\/$/g, '') || 'index'
  if (page.startsWith('api') && !existsSync(join(DOCS, 'api'))) {
    return 'the API reference has not been generated: run `pnpm docs:api` first'
  }
  const file = [join(DOCS, `${page}.md`), join(DOCS, page, 'index.md')].find(
    existsSync
  )
  if (!file) return 'there is no such page in docs/'
  if (anchor && !anchorsOf(file).has(anchor)) {
    return `docs/${relative(DOCS, file)} has no heading #${anchor}`
  }
}

/**
 * @param {string} url
 * @param {string} readme the README the link is in
 * @param {boolean} published whether the README is published to npm
 * @returns {string | undefined} why the link is broken, if it is
 */
const checkLink = (url, readme, published) => {
  if (OLD_DOCS.some(old => url.startsWith(old))) {
    return `link to ${SITE_URL} instead of the old docs`
  }
  if (url === SITE_URL || url.startsWith(`${SITE_URL}/`)) {
    return checkSiteLink(url)
  }
  const repository = new RegExp(
    `^${REPOSITORY_URL}/(?:blob|tree)/master/([^#?]+)`
  ).exec(url)
  if (repository) {
    const path = decodeURIComponent(repository[1])
    // `changeset version` writes a package's changelog at its first release
    const changelog = /^packages\/([\w-]+)\/CHANGELOG\.md$/.exec(path)
    const exists = changelog
      ? existsSync(join(ROOT, 'packages', changelog[1], 'package.json'))
      : existsSync(join(ROOT, path))
    return exists ? undefined : `${path} doesn't exist in the repository`
  }
  if (/^[a-z]+:/i.test(url) || url.startsWith('#')) return
  if (published) {
    return "npm doesn't resolve relative links: use an absolute URL"
  }
  const path = url.split('#')[0]
  return existsSync(join(dirname(readme), path))
    ? undefined
    : `${path} doesn't exist`
}

/**
 * Checks that a package README follows the template in docs/README.md
 * @param {string} content
 * @param {string} pkg
 * @returns {string[]} what's wrong
 */
const checkTemplate = (content, pkg) => {
  const name = `@node-ts/${pkg}`
  const problems = []
  if (!content.startsWith(`# ${name}\n`)) {
    problems.push(`start with "# ${name}"`)
  }
  if (!content.includes(`(https://www.npmjs.com/package/${name})`)) {
    problems.push('have the npm version badge')
  }
  if (
    !new RegExp(`\\*\\*\\[Documentation\\]\\(${SITE_URL}[^)]*\\)\\*\\*`).test(
      content
    )
  ) {
    problems.push(
      `have the links line, starting with **[Documentation](${SITE_URL}/...)**`
    )
  }
  if (!content.includes('Requires Node.js 24 or later.')) {
    problems.push('say "Requires Node.js 24 or later." under Installation')
  }
  const headings = [...content.matchAll(/^## (.+)$/gm)].map(([, h]) => h)
  const expected = ['Installation', 'Usage', 'Learn more']
  if (expected.some(h => !headings.includes(h))) {
    problems.push(`have the sections ${expected.join(', ')}`)
  }
  if (headings.at(-1) !== 'Learn more') {
    problems.push('end with "## Learn more"')
  }
  if (headings.includes('Development')) {
    problems.push(
      'have no Development section, since CONTRIBUTING.md covers it'
    )
  }
  return problems.map(
    p => `doesn't follow the template in docs/README.md: it should ${p}`
  )
}

/**
 * Syncs one README's snippets, and checks it
 * @param {{ file: string, pkg?: string }} readme
 * @returns {{ content: string, problems: string[] }}
 */
const syncReadme = ({ file, pkg }) => {
  const lines = readFileSync(file, 'utf8').split('\n')
  const problems = []
  const out = []
  /** @type {RegExpExecArray | null} */
  let marker = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = FENCE.exec(line.trim())
    if (MARKER.test(line)) {
      marker = MARKER.exec(line)
      out.push(line)
      continue
    }
    if (!fence) {
      if (line.trim() && marker) {
        problems.push(
          `line ${i + 1}: a snippet marker must be followed by a code block`
        )
        marker = null
      }
      out.push(line)
      continue
    }

    // A code block: find where it ends
    const indent = line.slice(0, line.length - line.trimStart().length)
    const close = lines.findIndex(
      (l, j) =>
        j > i &&
        l.trim().startsWith(fence[1]) &&
        !l.trim().slice(fence[1].length).trim()
    )
    if (close === -1) {
      problems.push(`line ${i + 1}: the code block isn't closed`)
      out.push(...lines.slice(i))
      break
    }
    const language = fence[2]
    if (marker) {
      const [, path, region] = marker
      try {
        const code = readSnippet(path, region)
        const block = [
          `${indent}${fence[1]}${path.split('.').pop()}`,
          ...code.split('\n').map(l => (l ? indent + l : l)),
          `${indent}${fence[1]}`
        ]
        const current = lines.slice(i, close + 1)
        if (check && current.join('\n') !== block.join('\n')) {
          problems.push(
            `line ${i + 1}: out of date with docs/snippets/${path}${region ? `#${region}` : ''}`
          )
        }
        out.push(...block)
      } catch (error) {
        problems.push(`line ${i + 1}: ${/** @type {Error} */ (error).message}`)
        out.push(...lines.slice(i, close + 1))
      }
      marker = null
    } else {
      if (['ts', 'typescript', 'js', 'javascript', 'tsx'].includes(language)) {
        problems.push(
          `line ${i + 1}: a ${language} code block must come from docs/snippets, with a <!-- <<< @/snippets/file.ts#region --> marker before it`
        )
      }
      out.push(...lines.slice(i, close + 1))
    }
    i = close
  }

  const content = out.join('\n')
  for (const [, url] of content.matchAll(/\]\(([^)\s]+)\)/g)) {
    const problem = checkLink(url, file, !!pkg)
    if (problem) problems.push(`${url}: ${problem}`)
  }
  if (pkg) problems.push(...checkTemplate(content, pkg))
  return { content, problems }
}

let failed = false
for (const readme of readmes()) {
  const { content, problems } = syncReadme(readme)
  const name = relative(ROOT, readme.file)
  if (!check && content !== readFileSync(readme.file, 'utf8')) {
    writeFileSync(readme.file, content)
    console.log(`Synced ${name}`)
  }
  for (const problem of problems) {
    failed = true
    console.error(`${name}: ${problem}`)
  }
}

if (failed) {
  console.error(
    check
      ? '\nRun `pnpm docs:sync-readmes` to update the code blocks, and fix the rest by hand.'
      : '\nFix the problems above by hand.'
  )
  process.exit(1)
}
console.log(
  check ? 'The READMEs are in sync with the docs' : 'The READMEs are synced'
)
