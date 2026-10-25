import { buildComposeFile, composeFilesOf } from './build-compose-file'
import { buildEnvExample } from './build-env-example'
import { readOptionManifests } from './option-manifest'
import { TEMPLATE_DIRECTORY } from './test'

const options = readOptionManifests(TEMPLATE_DIRECTORY)
const find = (kind: 'transport' | 'persistence', name: string) =>
  options[kind].find(option => option.name === name)!

describe('buildComposeFile', () => {
  describe('when the Postgres transport and persistence are chosen', () => {
    const chosen = [
      find('transport', 'postgres'),
      find('persistence', 'postgres')
    ]

    it('should include the Postgres compose file once', () => {
      expect(composeFilesOf(chosen)).toEqual(['compose.postgres.yaml'])
    })

    it('should provision once Postgres is healthy, then run the app', () => {
      expect(buildComposeFile(chosen)).toMatchInlineSnapshot(`
"# \`docker compose up -d --wait\` starts the services the app uses, for running
# it and its tests on your machine. \`docker compose --profile app up --build\`
# also creates their queues and tables, then runs the app in a container.
include:
  - compose.postgres.yaml

x-environment: &environment
  DATABASE_URL: "postgres://postgres:postgres@postgres:5432/postgres"

services:
  # Creates the queues and tables the app needs with \`bus provision\`, then
  # exits. It runs in the build stage, which has the dev dependencies.
  provision:
    profiles: [app]
    build:
      context: .
      target: build
    command: [node_modules/.bin/bus, provision, dist/bus-configuration.js]
    environment: *environment
    depends_on:
      postgres:
        condition: service_healthy

  app:
    profiles: [app]
    build: .
    environment: *environment
    depends_on:
      provision:
        condition: service_completed_successfully
    restart: unless-stopped
"
`)
    })
  })

  describe('when SQS and MongoDB are chosen', () => {
    const chosen = [find('transport', 'sqs'), find('persistence', 'mongodb')]
    let sut: string

    beforeAll(() => {
      sut = buildComposeFile(chosen)
    })

    it('should include both compose files', () => {
      expect(sut).toContain(
        'include:\n  - compose.localstack.yaml\n  - compose.mongodb.yaml\n'
      )
    })

    it('should point the containers at the services by their names', () => {
      expect(sut).toContain('  AWS_ENDPOINT_URL: "http://localstack:4566"\n')
      expect(sut).toContain(
        '  MONGODB_URL: "mongodb://mongodb:27017/?directConnection=true"\n'
      )
      expect(sut).toContain('  AWS_ACCOUNT_ID: "000000000000"\n')
    })

    it('should wait for both services before provisioning', () => {
      expect(sut).toContain(
        '      localstack:\n        condition: service_healthy\n      mongodb:\n        condition: service_healthy\n'
      )
    })
  })
})

describe('buildEnvExample', () => {
  describe('when the Postgres transport and persistence are chosen', () => {
    it('should list DATABASE_URL once, for the machine', () => {
      const sut = buildEnvExample([
        find('transport', 'postgres'),
        find('persistence', 'postgres')
      ])
      expect(sut.match(/^DATABASE_URL=/gm)).toHaveLength(1)
      expect(sut).toContain(
        '# Postgres transport\nDATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres\n'
      )
    })
  })

  describe('when SQS is chosen', () => {
    it('should comment the LocalStack endpoint', () => {
      const sut = buildEnvExample([
        find('transport', 'sqs'),
        find('persistence', 'mongodb')
      ])
      expect(sut).toContain(
        '# LocalStack. Remove it to use AWS.\nAWS_ENDPOINT_URL=http://localhost:4566\n'
      )
      expect(sut).toContain(
        '# MongoDB persistence\nMONGODB_URL=mongodb://localhost:27017/?directConnection=true\n'
      )
    })
  })
})
