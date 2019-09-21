// .vuepress/config.js
module.exports = {
  title: '@node-ts/bus',
  description: 'Enterprise message bus library for typescript',
  dest: './docs',
  base: '/bus/',
  serviceWorker: true,
  head: [
    ['script', { async: 'async', src: 'https://www.googletagmanager.com/gtag/js?id=UA-139036417-1' }],
    ['script', {}, `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());

      gtag('config', 'UA-139036417-1');
    `]
  ],
  plugins: {
    'sitemap': {
      hostname: 'https://node-ts.github.io/bus'
    }
  },
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Handlers', link: '/packages/bus-core/src/handler/' },
      {
        text: 'Transports',
        link: '/packages/bus/src/transport/',
        items: [
          { text: 'SQS', link: '/packages/bus-sqs/' },
          { text: 'RabbitMQ', link: '/packages/bus-rabbitmq/' },
        ]
      },
      { text: 'Workflows', link: '/packages/bus-workflow/' },
      {
        text: 'Persistence',
        link: '/packages/bus/src/persistence/',
        items: [
          { text: 'Postgres', link: '/packages/bus-postgres/' }
        ]
      },
      { text: 'Github', link: 'https://github.com/node-ts/bus' },
    ],
    sidebar: {
      '/': [
        ['/', 'Home'],
        ['/packages/bus-messages/', 'Messages'],
        ['/packages/bus-core/src/handler/', 'Handlers'],
        ['/packages/bus-core/src/transport/', 'Transports'],
        ['/packages/bus-workflow/', 'Workflows'],
        ['/packages/bus-workflow/src/workflow/persistence/', 'Persistence']
      ]
    }
  }
}
