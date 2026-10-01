#!/usr/bin/env node
// This file lives outside dist so that package managers can link the bin before the package is
// built, e.g. in this repo's workspace
import { runCli } from './dist/cli.js'

process.exitCode = await runCli(process.argv.slice(2))
