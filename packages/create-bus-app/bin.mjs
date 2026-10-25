#!/usr/bin/env node
// This file lives outside dist so that package managers can link the bin before the package is
// built, e.g. in this repo's workspace. It checks the Node.js version before loading anything that
// might not run on an older one.
const NODE_MAJOR = Number(process.versions.node.split('.')[0])

if (NODE_MAJOR < 24) {
  console.error(
    `@node-ts/bus needs Node.js 24 or later, and this is Node.js ${process.versions.node}. Install Node.js 24 (https://nodejs.org) and run this again.`
  )
  process.exit(1)
}

const { runCli } = await import('./dist/cli.js')
process.exitCode = await runCli(process.argv.slice(2))
