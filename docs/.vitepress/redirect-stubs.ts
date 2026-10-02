import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Old paths, from the GitBook site and the legacy GitHub Pages site, and the page each one moved to
 */
interface RedirectMap {
  gitbook: Record<string, string>
  legacy: Record<string, string>
}

const REDIRECTS_FILE = fileURLToPath(
  new URL('../redirects.json', import.meta.url)
)

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

const redirectPage = (url: string) => {
  const href = escapeHtml(url)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page has moved</title>
    <meta name="robots" content="noindex" />
    <link rel="canonical" href="${href}" />
    <meta http-equiv="refresh" content="0; url=${href}" />
    <script>location.replace(${JSON.stringify(url)} + location.hash)</script>
  </head>
  <body>
    <p>This page has moved to <a href="${href}">${href}</a>.</p>
  </body>
</html>
`
}

/**
 * The markdown export of a page, as vitepress-plugin-llms writes it, or the docs index for the home page
 */
const markdownPathOf = (path: string) =>
  path === '/' ? '/llms.txt' : `${path.replace(/\/$/, '')}.md`

const writeFile = (outDir: string, path: string, content: string) => {
  const file = join(outDir, path)
  if (existsSync(file)) {
    throw new Error(
      `Can't write a redirect stub at ${path}, since the site has a page there. Remove it from docs/redirects.json.`
    )
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

/**
 * Writes a page at each old path in docs/redirects.json that sends the browser on to the page it moved to, since
 * GitHub Pages can't send redirects. GitBook also served each page as markdown with `.md` added, so those paths get a
 * markdown note with the new address.
 * @param outDir the build output
 * @param siteUrl the site's URL, including its base, such as `https://node-ts.github.io/bus`
 * @returns the number of old paths
 * @throws if an old path is a page of the site
 */
export const writeRedirectStubs = (outDir: string, siteUrl: string): number => {
  const redirects = JSON.parse(
    readFileSync(REDIRECTS_FILE, 'utf8')
  ) as RedirectMap
  const all = { ...redirects.gitbook, ...redirects.legacy }

  for (const [from, to] of Object.entries(all)) {
    const page = redirectPage(`${siteUrl}${to}`)
    if (from.endsWith('/')) {
      writeFile(outDir, `${from}index.html`, page)
    } else {
      // GitHub Pages serves /a from a.html, or redirects it to /a/ when there's also a folder called a
      writeFile(outDir, `${from}.html`, page)
      writeFile(outDir, `${from}/index.html`, page)
    }
  }

  for (const [from, to] of Object.entries(redirects.gitbook)) {
    const markdown = markdownPathOf(to)
    const alsoMarkdown = existsSync(join(outDir, markdown))
      ? ` Its markdown is at ${siteUrl}${markdown}.`
      : ''
    writeFile(
      outDir,
      markdownPathOf(from),
      `# This page has moved\n\nIt's now at ${siteUrl}${to}.${alsoMarkdown}\n`
    )
  }

  return Object.keys(all).length
}
