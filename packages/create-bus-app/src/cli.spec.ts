import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CliContext, runCli } from './cli'
import { FakeCliIo, TEMPLATE_DIRECTORY, TEST_VERSIONS } from './test'

describe('runCli', () => {
  let cwd: string
  const context = (env: NodeJS.ProcessEnv = {}): CliContext => ({
    cwd,
    env,
    templateDirectory: TEMPLATE_DIRECTORY,
    readVersions: () => TEST_VERSIONS
  })
  const readJson = (path: string) =>
    JSON.parse(readFileSync(join(cwd, path), 'utf8'))
  const read = (path: string) => readFileSync(join(cwd, path), 'utf8')

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'create-bus-app-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  describe('when run with --yes', () => {
    let exitCode: number
    let io: FakeCliIo

    beforeEach(async () => {
      io = new FakeCliIo(true)
      exitCode = await runCli(['library', '--yes'], io, context())
    })

    it('should create the app with the defaults, asking nothing', () => {
      expect(exitCode).toEqual(0)
      expect(io.questions).toEqual([])
      expect(readJson('library/package.json').dependencies).toEqual({
        '@node-ts/bus-core': '^2.1.0',
        '@node-ts/bus-messages': '^2.0.1',
        '@node-ts/bus-postgres': '^2.0.0'
      })
    })

    it('should copy the chosen transport and persistence', () => {
      expect(read('library/src/transport.ts')).toContain('PostgresTransport')
      expect(read('library/src/persistence.ts')).toContain(
        'PostgresPersistence'
      )
      expect(existsSync(join(cwd, 'library/src/transport'))).toEqual(false)
      expect(existsSync(join(cwd, 'library/options'))).toEqual(false)
    })

    it('should rename the files npm leaves out of packages', () => {
      expect(read('library/.gitignore')).toContain('node_modules')
      expect(read('library/.dockerignore')).toContain('node_modules')
      expect(existsSync(join(cwd, 'library/_gitignore'))).toEqual(false)
    })

    it('should name everything after the project', () => {
      expect(read('library/src/messages.ts')).toContain(
        "static NAME = 'library/lend-book'"
      )
      expect(read('library/src/message-types.generated.ts')).toContain(
        "source: 'library/src/message-types.generated'"
      )
      expect(read('library/README.md')).toMatch(/^# library\n/)
      expect(read('library/README.md')).not.toContain('create-bus-app-template')
    })

    it('should use the npm Dockerfile', () => {
      expect(read('library/Dockerfile')).toContain('npm ci')
    })

    it('should print the next steps', () => {
      expect(io.logged).toContain('  cd library')
      expect(io.logged).toContain('  npm install')
      expect(io.closed).toEqual(true)
    })
  })

  describe('when run with --transport and --persistence by pnpm', () => {
    let io: FakeCliIo

    beforeEach(async () => {
      io = new FakeCliIo(false)
      await runCli(
        ['library', '--transport', 'rabbitmq', '-p', 'mongodb'],
        io,
        context({
          npm_config_user_agent: 'pnpm/12.4.1 npm/? node/v24.11.1 linux x64'
        })
      )
    })

    it('should create the app with them', () => {
      expect(
        Object.keys(readJson('library/package.json').dependencies)
      ).toEqual([
        '@node-ts/bus-core',
        '@node-ts/bus-messages',
        '@node-ts/bus-mongodb',
        '@node-ts/bus-rabbitmq'
      ])
      expect(existsSync(join(cwd, 'library/compose.rabbitmq.yaml'))).toEqual(
        true
      )
      expect(existsSync(join(cwd, 'library/compose.mongodb.yaml'))).toEqual(
        true
      )
      expect(existsSync(join(cwd, 'library/compose.postgres.yaml'))).toEqual(
        false
      )
    })

    it('should use the pnpm Dockerfile and next steps', () => {
      expect(read('library/Dockerfile')).toContain('pnpm install')
      expect(readJson('library/package.json').packageManager).toEqual(
        'pnpm@12.4.1'
      )
      expect(io.logged).toContain('  pnpm install')
    })
  })

  describe('when run in a terminal without the options', () => {
    let io: FakeCliIo
    let exitCode: number

    beforeEach(async () => {
      // A directory, an answer that isn't an option, RabbitMQ, then the default persistence
      io = new FakeCliIo(true, ['library', '7', '2', ''])
      exitCode = await runCli([], io, context())
    })

    it('should ask for each of them', () => {
      expect(exitCode).toEqual(0)
      expect(io.questions).toEqual([
        'Where should the app go? (bus-app): ',
        'Choose 1-4 (1): ',
        'Choose 1-4 (1): ',
        'Choose 1-2 (1): '
      ])
      expect(io.logged).toContain('Type a number from 1 to 4.')
    })

    it('should create the app with the answers', () => {
      expect(readJson('library/package.json').dependencies).toHaveProperty(
        '@node-ts/bus-rabbitmq'
      )
      expect(readJson('library/package.json').dependencies).toHaveProperty(
        '@node-ts/bus-postgres'
      )
    })
  })

  describe('when not run in a terminal', () => {
    it('should create the app in bus-app with the defaults, asking nothing', async () => {
      const io = new FakeCliIo(false)
      expect(await runCli([], io, context())).toEqual(0)
      expect(io.questions).toEqual([])
      expect(readJson('bus-app/package.json').name).toEqual('bus-app')
    })
  })

  describe('when the directory has files in it', () => {
    it('should fail without writing anything', async () => {
      mkdirSync(join(cwd, 'library'))
      writeFileSync(join(cwd, 'library', 'notes.txt'), 'mine')
      const io = new FakeCliIo(false)

      expect(await runCli(['library'], io, context())).toEqual(1)
      expect(io.errors[0]).toContain(
        "library already exists and isn't an empty directory."
      )
      expect(existsSync(join(cwd, 'library', 'package.json'))).toEqual(false)
    })
  })

  describe('when the directory is empty', () => {
    it('should create the app in it', async () => {
      mkdirSync(join(cwd, 'library'))
      expect(
        await runCli(['library'], new FakeCliIo(false), context())
      ).toEqual(0)
      expect(existsSync(join(cwd, 'library', 'package.json'))).toEqual(true)
    })
  })

  describe('when the transport is unknown', () => {
    it('should fail with a usage error naming the options', async () => {
      const io = new FakeCliIo(false)
      expect(
        await runCli(['library', '--transport', 'kafka'], io, context())
      ).toEqual(2)
      expect(io.errors[0]).toEqual(
        "--transport kafka isn't one of the options.\nUse one of: postgres, rabbitmq, sqs, redis."
      )
    })
  })

  describe('when an option is unknown', () => {
    it('should fail with the usage', async () => {
      const io = new FakeCliIo(false)
      expect(await runCli(['--nope'], io, context())).toEqual(2)
      expect(io.errors[0]).toContain('Usage: npm create @node-ts/bus-app')
    })
  })

  describe('when run with --help', () => {
    it('should print the usage with every option', async () => {
      const io = new FakeCliIo(false)
      expect(await runCli(['--help'], io, context())).toEqual(0)
      expect(io.logged[0]).toContain(
        '  sqs        Amazon SQS: SQS queues and SNS topics, with LocalStack in development'
      )
    })
  })

  describe('when tarballs are given', () => {
    it('should copy them, and depend on them', async () => {
      const tarballs = join(cwd, 'packed')
      mkdirSync(tarballs)
      writeFileSync(join(tarballs, 'node-ts-bus-core-2.1.0.tgz'), 'packed')
      await runCli(
        ['library'],
        new FakeCliIo(false),
        context({ CREATE_BUS_APP_TARBALLS: 'packed' })
      )

      const packageJson = readJson('library/package.json')
      expect(packageJson.dependencies['@node-ts/bus-core']).toEqual(
        'file:tarballs/node-ts-bus-core-2.1.0.tgz'
      )
      expect(packageJson.overrides).toEqual({
        '@node-ts/bus-core': 'file:tarballs/node-ts-bus-core-2.1.0.tgz'
      })
      expect(read('library/pnpm-workspace.yaml')).toEqual(
        "overrides:\n  '@node-ts/bus-core': file:tarballs/node-ts-bus-core-2.1.0.tgz\n"
      )
      expect(read('library/tarballs/node-ts-bus-core-2.1.0.tgz')).toEqual(
        'packed'
      )
    })
  })
})
