import {
  Bus,
  BusConfiguration,
  InMemoryQueue,
  Logger,
  ProvisioningPlan,
  ResourcesNotProvisioned,
  TransportProvisionOptions
} from '@node-ts/bus-core'
import { Mock } from 'typemoq'
import { CommandOutput } from '../generate-message-types/run-generate-message-types'
import { ImportModule } from './load-bus-configuration'
import { ProvisionReport } from './provision-report'
import { runProvision } from './run-provision'

class CapturedOutput implements CommandOutput {
  readonly logs: string[] = []
  readonly errors: string[] = []

  log(message: string): void {
    this.logs.push(message)
  }

  error(message: string): void {
    this.errors.push(message)
  }
}

/**
 * An in-memory queue that plans a topic for each message, and records how it was provisioned and disposed
 */
class ProvisionedQueue extends InMemoryQueue {
  provisionOptions: TransportProvisionOptions | undefined
  wasDisposed = false
  failWith: Error | undefined
  failToDisposeWith: Error | undefined

  async provision(
    options: TransportProvisionOptions
  ): Promise<ProvisioningPlan> {
    this.provisionOptions = options
    if (this.failWith) {
      throw this.failWith
    }
    return {
      adapter: 'ProvisionedQueue',
      resources: options.messageNames.map(name => ({
        type: 'topic',
        name,
        properties: { durable: true }
      })),
      runtimePermissions: {
        format: 'iam-policy',
        document: { Version: '2012-10-17', Statement: [] }
      }
    }
  }

  async dispose(): Promise<void> {
    this.wasDisposed = true
    await super.dispose()
    if (this.failToDisposeWith) {
      throw this.failToDisposeWith
    }
  }
}

const configure = (transport: ProvisionedQueue): BusConfiguration =>
  Bus.configure()
    .withLogger(() => Mock.ofType<Logger>().object)
    .withTransport(transport)
    .withMessageTypes({
      messages: { 'test/order-placed': 'order-placed' },
      types: { 'order-placed': { fields: {} } }
    })

/**
 * Runs the command with a module that has the given exports
 */
const run = async (
  exports: Record<string, unknown>,
  ...args: string[]
): Promise<{ exitCode: number; output: CapturedOutput; url: string }> => {
  const output = new CapturedOutput()
  let url = ''
  const load: ImportModule = async moduleUrl => {
    url = moduleUrl
    return exports
  }
  const exitCode = await runProvision(args, output, '/service', load)
  return { exitCode, output, url }
}

describe('runProvision', () => {
  describe('when a module exports a bus configuration', () => {
    let transport: ProvisionedQueue
    let exitCode: number
    let output: CapturedOutput
    let url: string

    beforeAll(async () => {
      transport = new ProvisionedQueue()
      ;({ exitCode, output, url } = await run(
        { default: configure(transport) },
        'src/bus.js'
      ))
    })

    it('should import the module from the working directory', () => {
      expect(url).toEqual('file:///service/src/bus.js')
    })

    it('should provision the bus', () => {
      expect(exitCode).toEqual(0)
      expect(transport.provisionOptions).toMatchObject({
        dryRun: false,
        messageNames: ['test/order-placed']
      })
    })

    it('should dispose the bus', () => {
      expect(transport.wasDisposed).toEqual(true)
    })

    it('should print what it provisioned', () => {
      expect(output.logs.join('\n')).toEqual(
        [
          'Provisioned the bus in src/bus.js.',
          '',
          'ProvisionedQueue (1 resource)',
          '  topic  test/order-placed'
        ].join('\n')
      )
    })
  })

  describe('when a module exports an async function that returns a bus configuration', () => {
    let transport: ProvisionedQueue
    let exitCode: number

    beforeAll(async () => {
      transport = new ProvisionedQueue()
      ;({ exitCode } = await run(
        { createBus: async () => configure(transport) },
        'src/bus.js',
        '--export',
        'createBus'
      ))
    })

    it('should provision the bus it returns', () => {
      expect(exitCode).toEqual(0)
      expect(transport.provisionOptions).toBeDefined()
    })
  })

  describe('when a CommonJS module exports a function under a name', () => {
    let transport: ProvisionedQueue
    let exitCode: number

    beforeAll(async () => {
      transport = new ProvisionedQueue()
      ;({ exitCode } = await run(
        { default: { createBus: () => configure(transport) } },
        'src/bus.js',
        '--export',
        'createBus'
      ))
    })

    it('should find it on the module exports', () => {
      expect(exitCode).toEqual(0)
      expect(transport.provisionOptions).toBeDefined()
    })
  })

  describe('when it is a dry run printed as JSON with permissions', () => {
    let transport: ProvisionedQueue
    let report: ProvisionReport

    beforeAll(async () => {
      transport = new ProvisionedQueue()
      const { output } = await run(
        { default: configure(transport) },
        'src/bus.js',
        '--dry-run',
        '--json',
        '--permissions'
      )
      report = JSON.parse(output.logs.join('\n')) as ProvisionReport
    })

    it('should only plan', () => {
      expect(transport.provisionOptions?.dryRun).toEqual(true)
    })

    it('should print the report', () => {
      expect(report).toEqual({
        formatVersion: 1,
        dryRun: true,
        adapters: [
          {
            adapter: 'ProvisionedQueue',
            resources: [
              {
                type: 'topic',
                name: 'test/order-placed',
                properties: { durable: true }
              }
            ],
            runtimePermissions: {
              format: 'iam-policy',
              document: { Version: '2012-10-17', Statement: [] }
            }
          }
        ]
      })
    })
  })

  describe('when the plan is printed with permissions', () => {
    let output: CapturedOutput

    beforeAll(async () => {
      ;({ output } = await run(
        { default: configure(new ProvisionedQueue()) },
        'src/bus.js',
        '--dry-run',
        '--permissions'
      ))
    })

    it('should say nothing was changed and print the permissions', () => {
      const printed = output.logs.join('\n')
      expect(printed).toContain(
        'Plan for the bus in src/bus.js. Nothing was changed.'
      )
      expect(printed).toContain('  Runtime permissions (iam-policy):')
      expect(printed).toContain('    "Version": "2012-10-17"')
    })
  })

  describe('when the bus has nothing to provision', () => {
    let output: CapturedOutput

    beforeAll(async () => {
      ;({ output } = await run(
        {
          default: Bus.configure().withLogger(
            () => Mock.ofType<Logger>().object
          )
        },
        'src/bus.js'
      ))
    })

    it('should say so', () => {
      expect(output.logs.join('\n')).toContain('has nothing to provision')
    })
  })

  describe('when the export is not a bus configuration', () => {
    let exitCode: number
    let output: CapturedOutput

    beforeAll(async () => {
      ;({ exitCode, output } = await run({ default: 42 }, 'src/bus.js'))
    })

    it('should fail, saying what to export', () => {
      expect(exitCode).toEqual(1)
      expect(output.errors.join('\n')).toContain(
        "The default export of src/bus.js isn't a bus configuration or a function that returns one, it's a number"
      )
      expect(output.errors.join('\n')).toContain('--export')
    })
  })

  describe('when the module cannot be imported', () => {
    let exitCode: number
    let output: CapturedOutput

    beforeAll(async () => {
      output = new CapturedOutput()
      exitCode = await runProvision(['src/bus.js'], output, '/service', () =>
        Promise.reject(new Error('Cannot find module'))
      )
    })

    it('should fail, saying how to load it', () => {
      expect(exitCode).toEqual(1)
      expect(output.errors.join('\n')).toContain(
        'src/bus.js could not be imported: Cannot find module'
      )
    })
  })

  describe('when provisioning fails', () => {
    let transport: ProvisionedQueue
    let exitCode: number
    let output: CapturedOutput

    beforeAll(async () => {
      transport = new ProvisionedQueue()
      transport.failWith = new ResourcesNotProvisioned('ProvisionedQueue', [
        'topic test/order-placed'
      ])
      ;({ exitCode, output } = await run(
        { default: configure(transport) },
        'src/bus.js'
      ))
    })

    it('should fail with the error and its help', () => {
      expect(exitCode).toEqual(1)
      expect(output.errors.join('\n')).toContain(
        'Provisioning failed: ProvisionedQueue can'
      )
      expect(output.errors.join('\n')).toContain('withAutoProvision()')
    })

    it('should still dispose the bus', () => {
      expect(transport.wasDisposed).toEqual(true)
    })
  })

  describe('when the bus is provisioned but fails to dispose', () => {
    let exitCode: number
    let output: CapturedOutput

    beforeAll(async () => {
      const transport = new ProvisionedQueue()
      transport.failToDisposeWith = new Error('Connection already closed')
      ;({ exitCode, output } = await run(
        { default: configure(transport) },
        'src/bus.js'
      ))
    })

    it('should succeed, printing what it provisioned', () => {
      expect(exitCode).toEqual(0)
      expect(output.logs.join('\n')).toContain('Provisioned the bus')
    })

    it('should warn that disposing failed', () => {
      expect(output.errors).toEqual([
        'Warning: the bus could not be disposed: Connection already closed'
      ])
    })
  })

  describe('when provisioning fails and so does disposing', () => {
    let exitCode: number
    let output: CapturedOutput

    beforeAll(async () => {
      const transport = new ProvisionedQueue()
      transport.failWith = new Error('Access denied')
      transport.failToDisposeWith = new Error('Connection already closed')
      ;({ exitCode, output } = await run(
        { default: configure(transport) },
        'src/bus.js'
      ))
    })

    it('should report why provisioning failed', () => {
      expect(exitCode).toEqual(1)
      expect(output.errors).toEqual([
        'Warning: the bus could not be disposed: Connection already closed',
        'Provisioning failed: Access denied'
      ])
    })
  })

  describe('when no module is given', () => {
    let exitCode: number
    let output: CapturedOutput

    beforeAll(async () => {
      ;({ exitCode, output } = await run({}))
    })

    it('should fail with the usage', () => {
      expect(exitCode).toEqual(2)
      expect(output.errors.join('\n')).toContain(
        'Usage: bus provision <module>'
      )
    })
  })
})
