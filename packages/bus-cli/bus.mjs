#!/usr/bin/env node
// This file lives outside dist so that package managers can link the bin before the package is
// built, e.g. in this repo's workspace
import { runCli } from './dist/cli.js'

const exitCode = await runCli(process.argv.slice(2))

// Exit once the output is written, rather than waiting for the event loop to empty: a module that
// `bus provision` loads may leave handles open, such as an application's database pool
const flush = stream => new Promise(resolve => stream.write('', resolve))
await Promise.all([flush(process.stdout), flush(process.stderr)])
process.exit(exitCode)
