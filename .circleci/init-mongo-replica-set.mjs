#!/usr/bin/env node
// Initiates the single-node replica set that CircleCI's mongo container runs
// with `--replSet rs0`, since the outbox's MongoDB transactions need one, and
// waits until the member is primary. Running it again is a no-op.
//
// Env: MONGODB_URL (optional, defaults to mongodb://127.0.0.1:27017). The
// member is initiated as 127.0.0.1:27017, the address it has in CircleCI.

import { createRequire } from 'node:module'

// mongodb is a dependency of bus-mongodb, not of the repo root
const require = createRequire(
  new URL('../packages/bus-mongodb/package.json', import.meta.url)
)
const { MongoClient } = require('mongodb')

const REPLICA_SET = 'rs0'
const MEMBER_HOST = '127.0.0.1:27017'
const PRIMARY_TIMEOUT_MS = 60_000

const url = new URL(process.env.MONGODB_URL || 'mongodb://127.0.0.1:27017')
// Not initiated yet, so the server can't be discovered as a replica set member
url.searchParams.set('directConnection', 'true')
const client = new MongoClient(url.toString())

try {
  await client.connect()
  const admin = client.db('admin')
  try {
    await admin.command({
      replSetInitiate: {
        _id: REPLICA_SET,
        members: [{ _id: 0, host: MEMBER_HOST }]
      }
    })
    console.log(`Initiated replica set ${REPLICA_SET}`)
  } catch (error) {
    if (error.codeName !== 'AlreadyInitialized') {
      throw error
    }
    console.log(`Replica set ${REPLICA_SET} is already initiated`)
  }
  const deadline = Date.now() + PRIMARY_TIMEOUT_MS
  while (!(await admin.command({ hello: 1 })).isWritablePrimary) {
    if (Date.now() > deadline) {
      throw new Error(`${MEMBER_HOST} did not become primary in time`)
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  console.log(`${MEMBER_HOST} is primary`)
} finally {
  await client.close()
}
