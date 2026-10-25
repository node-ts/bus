import { existsSync } from 'node:fs'

// Reads .env when there is one, as in development. Variables that are already
// set, such as by docker compose or CI, win over the file.
if (existsSync('.env')) {
  process.loadEnvFile('.env')
}
