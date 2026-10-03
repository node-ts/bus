import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type DefaultTheme } from 'vitepress'
import llmstxt from 'vitepress-plugin-llms'
import { writeRedirectStubs } from './redirect-stubs'

// Served by GitHub Pages as the node-ts/bus project site
const ORIGIN = 'https://node-ts.github.io'
const BASE = '/bus/'
const SITE_URL = `${ORIGIN}/bus`
const REPOSITORY_URL = 'https://github.com/node-ts/bus'
const TITLE = '@node-ts/bus'
const DESCRIPTION =
  'A TypeScript service bus for message-driven Node.js applications: handlers, workflows, retries and pluggable transports.'

/**
 * The API reference sidebar that typedoc writes next to the generated pages. It only exists once `docs:api` has run,
 * which `docs:dev` and `docs:build` do first.
 */
const apiSidebar = (): DefaultTheme.SidebarItem[] => {
  const file = fileURLToPath(
    new URL('../api/typedoc-sidebar.json', import.meta.url)
  )
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
}

const gettingStarted: DefaultTheme.SidebarItem[] = [
  {
    text: 'Getting started',
    items: [
      { text: 'Installation', link: '/getting-started/installation' },
      { text: 'Handling messages', link: '/getting-started/handling-messages' },
      { text: 'Shutting down cleanly', link: '/getting-started/shutting-down' }
    ]
  }
]

const guide: DefaultTheme.SidebarItem[] = [
  {
    text: 'Messages',
    link: '/guide/messages',
    items: [
      { text: 'Events', link: '/guide/messages/events' },
      { text: 'Commands', link: '/guide/messages/commands' },
      { text: 'System messages', link: '/guide/messages/system-messages' }
    ]
  },
  {
    text: 'Message attributes',
    link: '/guide/message-attributes',
    items: [
      {
        text: 'Message id and sent time',
        link: '/guide/message-attributes/message-id'
      },
      {
        text: 'Correlation id',
        link: '/guide/message-attributes/correlation-id'
      },
      { text: 'Attributes', link: '/guide/message-attributes/attributes' },
      {
        text: 'Sticky attributes',
        link: '/guide/message-attributes/sticky-attributes'
      }
    ]
  },
  {
    text: 'Workflows',
    link: '/guide/workflows',
    items: [
      {
        text: 'Creating a workflow',
        link: '/guide/workflows/creating-a-workflow'
      },
      { text: 'Starting', link: '/guide/workflows/starting' },
      { text: 'Handling', link: '/guide/workflows/handling' },
      { text: 'State', link: '/guide/workflows/state' },
      { text: 'Completing', link: '/guide/workflows/completing' },
      { text: 'Example', link: '/guide/workflows/example' }
    ]
  },
  {
    text: 'Running in production',
    items: [
      { text: 'Retry strategies', link: '/guide/retry-strategies' },
      { text: 'Middleware', link: '/guide/middleware' },
      { text: 'Lifecycle hooks', link: '/guide/lifecycle-hooks' },
      { text: 'Dependency injection', link: '/guide/dependency-injection' },
      {
        text: 'Long running processes',
        link: '/guide/long-running-processes'
      },
      { text: 'Several buses', link: '/guide/multiple-buses' }
    ]
  },
  {
    text: 'Serializers',
    link: '/guide/serializers',
    items: [
      {
        text: 'Generating message types',
        link: '/guide/serializers/message-types'
      },
      { text: 'Class serializer', link: '/guide/serializers/class-serializer' }
    ]
  },
  {
    text: 'Loggers',
    link: '/guide/loggers',
    items: [{ text: 'Custom loggers', link: '/guide/loggers/custom-loggers' }]
  }
]

const infrastructure: DefaultTheme.SidebarItem[] = [
  {
    text: 'Transports',
    link: '/transports',
    items: [
      { text: 'RabbitMQ', link: '/transports/rabbitmq' },
      { text: 'Amazon SQS', link: '/transports/amazon-sqs' },
      { text: 'SQS and Lambda', link: '/transports/sqs-lambda' },
      { text: 'Custom transports', link: '/transports/custom' }
    ]
  },
  {
    text: 'Persistence',
    link: '/persistence',
    items: [
      { text: 'Postgres', link: '/persistence/postgres' },
      { text: 'MongoDB', link: '/persistence/mongodb' },
      { text: 'Custom persistence', link: '/persistence/custom' }
    ]
  }
]

const referenceGroup: DefaultTheme.SidebarItem = {
  text: 'Reference',
  items: [
    { text: 'API reference', link: '/api/' },
    { text: 'Upgrading to 2.0', link: '/upgrading/v2' }
  ]
}

/**
 * A sidebar for each package's API reference, with only that package's pages, so a page doesn't render the sidebar
 * of every package. The reference landing pages list the packages.
 */
const apiSidebars = (): DefaultTheme.SidebarMulti => {
  const packages = apiSidebar()
  const packageLinks: DefaultTheme.SidebarItem = {
    text: 'Packages',
    items: packages.map(({ text, link }) => ({ text, link }))
  }
  return {
    '/api/': [referenceGroup, packageLinks],
    '/upgrading/': [referenceGroup, packageLinks],
    ...Object.fromEntries(
      packages.map(item => [
        item.link!.replace(/index(\.md)?$/, ''),
        [referenceGroup, { ...item, collapsed: false }]
      ])
    )
  }
}

/**
 * The sidebar as one list for llms.txt, with each group's overview page as its first item. The API reference is left
 * out of llms.txt, but its pages are in llms-full.txt and have their own .md.
 */
const llmsSidebar = (): DefaultTheme.SidebarItem[] =>
  [...gettingStarted, ...guide, ...infrastructure, referenceGroup].map(
    group => ({
      text: group.text,
      items: [
        ...(group.link ? [{ text: group.text, link: group.link }] : []),
        ...(group.items ?? [])
      ]
    })
  )

export default defineConfig({
  lang: 'en-AU',
  title: TITLE,
  description: DESCRIPTION,
  base: BASE,
  cleanUrls: true,
  lastUpdated: true,
  // Dead internal links fail the build
  ignoreDeadLinks: false,
  srcExclude: ['README.md', 'snippets/**', 'scripts/**', 'typedoc/**'],
  sitemap: { hostname: `${SITE_URL}/` },
  head: [
    [
      'link',
      { rel: 'icon', type: 'image/svg+xml', href: `${BASE}favicon.svg` }
    ],
    ['meta', { name: 'theme-color', content: '#0d9488' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: TITLE }],
    ['meta', { property: 'og:image', content: `${SITE_URL}/og.png` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }]
  ],
  buildEnd(siteConfig) {
    const count = writeRedirectStubs(siteConfig.outDir, SITE_URL)
    console.log(`Wrote redirect stubs for ${count} old paths`)
  },
  transformPageData(pageData) {
    // Generated pages have no source to edit
    if (pageData.relativePath.startsWith('api/')) {
      pageData.frontmatter.editLink = false
      pageData.frontmatter.lastUpdated = false
    }
    const canonical = `${SITE_URL}/${pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')}`
    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push(
      ['link', { rel: 'canonical', href: canonical }],
      ['meta', { property: 'og:url', content: canonical }],
      ['meta', { property: 'og:title', content: pageData.title || TITLE }],
      [
        'meta',
        {
          property: 'og:description',
          content: pageData.description || DESCRIPTION
        }
      ]
    )
  },
  themeConfig: {
    logo: { src: '/logo.svg', alt: '' },
    siteTitle: TITLE,
    nav: [
      { text: 'Getting started', link: '/getting-started/installation' },
      { text: 'Guide', link: '/guide/messages', activeMatch: '^/guide/' },
      {
        text: 'Transports',
        link: '/transports',
        activeMatch: '^/(transports|persistence)'
      },
      {
        text: 'Reference',
        activeMatch: '^/(api|upgrading)',
        items: [
          { text: 'API reference', link: '/api/' },
          { text: 'Upgrading to 2.0', link: '/upgrading/v2' },
          {
            text: 'Changelog',
            link: `${REPOSITORY_URL}/blob/master/packages/bus-core/CHANGELOG.md`
          }
        ]
      }
    ],
    sidebar: {
      '/getting-started/': gettingStarted,
      '/guide/': guide,
      '/transports': infrastructure,
      '/persistence': infrastructure,
      ...apiSidebars()
    },
    socialLinks: [{ icon: 'github', link: REPOSITORY_URL }],
    editLink: {
      pattern: `${REPOSITORY_URL}/edit/master/docs/:path`,
      text: 'Edit this page on GitHub'
    },
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    // GitHub Pages serves this for any path without a page, including the old
    // site's pages that docs/redirects.json doesn't map
    notFound: {
      title: 'PAGE NOT FOUND',
      quote:
        "This page isn't here. The docs have moved and been reorganised, so it may have a new address: start from the home page, or search.",
      linkText: 'Go to the home page'
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © node-ts contributors'
    }
  },
  vite: {
    plugins: [
      llmstxt({
        title: TITLE,
        description: DESCRIPTION,
        // The plugin adds the base
        domain: ORIGIN,
        ignoreFiles: ['README.md', 'snippets/**', 'scripts/**', 'typedoc/**'],
        ignoreFilesPerOutput: { llmsTxt: ['api/**'] },
        sidebar: llmsSidebar(),
        // Keep the text of components such as <Card>, which strips with the HTML
        stripHTML: false
      })
    ]
  }
})
