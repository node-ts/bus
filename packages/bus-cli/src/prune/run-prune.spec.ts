import {
  Bus,
  BusConfiguration,
  handlerFor,
  InMemoryPersistence,
  InMemoryQueue,
  Logger,
  PruningPlan,
  TransportPruneOptions
} from '@node-ts/bus-core'
import { Event } from '@node-ts/bus-messages'
import { Mock } from 'typemoq'
import { CommandOutput } from '../generate-message-types/run-generate-message-types'
import { ImportModule } from '../provision/load-bus-configuration'
import { PruneReport } from './prune-report'
import { runPrune } from './run-prune'

class CapturedOutput implements CommandOutput {
  readonly logs: string[] = []
  readonly errors: string[] = []
  /**
   * Everything written, in order, to stdout (`log`) or stderr (`error`)
   */
  readonly written: string[] = []

  log(message: string): void {
    this.logs.push(message)
    this.written.push(`log: ${message}`)
  }

  error(message: string): void {
    this.errors.push(message)
    this.written.push(`error: ${message}`)
  }
}

class OrderPlaced extends Event {
  static NAME = 'test/order-placed'
  $name = OrderPlaced.NAME
  $version = 0
}

/**
 * An in-memory queue that finds an orphaned subscription until it's removed, and records how it was pruned
 */
class PrunedQueue extends InMemoryQueue {
  readonly pruneCalls: TransportPruneOptions[] = []
  /**
   * The messages the bus handled when it was first pruned, since disposing it clears its handler registry
   */
  handledMessageNames: string[] | undefined
  orphaned = ['test/order-cancelled']
  wasDisposed = false
  failWith: Error | undefined
  /**
   * What had been written when the subscriptions were removed
   */
  writtenWhenRemoved: string[] | undefined

  constructor(private readonly output?: CapturedOutput) {
    super()
  }

  async prune(options: TransportPruneOptions): Promise<PruningPlan> {
    this.pruneCalls.push(options)
    this.handledMessageNames ??= options.handlerRegistry.getMessageNames()
    if (this.failWith) {
      throw this.failWith
    }
    const plan: PruningPlan = {
      adapter: 'PrunedQueue',
      resources: this.orphaned.map(name => ({
        type: 'subscription',
        name,
        properties: { topic: name }
      })),
      removed: options.apply
    }
    if (options.apply) {
      this.writtenWhenRemoved = [...(this.output?.written ?? [])]
      this.orphaned = []
    }
    return plan
  }

  async dispose(): Promise<void> {
    this.wasDisposed = true
    await super.dispose()
  }
}

const configure = (transport: InMemoryQueue): BusConfiguration =>
  Bus.configure()
    .withLogger(() => Mock.ofType<Logger>().object)
    .withTransport(transport)
    .withMessageTypes({
      messages: { [OrderPlaced.NAME]: 'order-placed' },
      types: { 'order-placed': { class: OrderPlaced, fields: {} } }
    })
    .withHandler(handlerFor(OrderPlaced, () => undefined))

/**
 * Runs the command with a module that has the given exports
 */
const run = async (
  exports: Record<string, unknown>,
  args: string[],
  output = new CapturedOutput()
): Promise<{ exitCode: number; output: CapturedOutput }> => {
  const load: ImportModule = async () => exports
  const exitCode = await runPrune(args, output, '/service', load)
  return { exitCode, output }
}

describe('runPrune', () => {
  describe('when a bus has something to prune', () => {
    let transport: PrunedQueue
    let exitCode: number
    let output: CapturedOutput

    beforeAll(async () => {
      transport = new PrunedQueue()
      ;({ exitCode, output } = await run({ default: configure(transport) }, [
        'src/bus.js'
      ]))
    })

    it('should only report it', () => {
      expect(exitCode).toEqual(0)
      expect(transport.pruneCalls.map(({ apply }) => apply)).toEqual([false])
      expect(transport.handledMessageNames).toEqual([OrderPlaced.NAME])
    })

    it('should print what it would remove', () => {
      expect(output.logs.join('\n')).toEqual(
        [
          'Found 1 resource the bus in src/bus.js no longer needs. Nothing was removed: run again with --apply to remove them.',
          '',
          'PrunedQueue (1 resource)',
          '  subscription  test/order-cancelled'
        ].join('\n')
      )
    })

    it('should dispose the bus', () => {
      expect(transport.wasDisposed).toEqual(true)
    })
  })

  describe('when a bus is pruned with --apply', () => {
    let transport: PrunedQueue
    let exitCode: number
    let output: CapturedOutput

    beforeAll(async () => {
      output = new CapturedOutput()
      transport = new PrunedQueue(output)
      ;({ exitCode } = await run(
        { default: configure(transport) },
        ['src/bus.js', '--apply'],
        output
      ))
    })

    it('should find what to remove, then remove it', () => {
      expect(exitCode).toEqual(0)
      expect(transport.pruneCalls.map(({ apply }) => apply)).toEqual([
        false,
        true
      ])
    })

    it('should print what it removes before removing it', () => {
      expect(transport.writtenWhenRemoved).toEqual([
        [
          'log: Removing 1 resource the bus in src/bus.js no longer needs:',
          '',
          'PrunedQueue (1 resource)',
          '  subscription  test/order-cancelled',
          ''
        ].join('\n')
      ])
    })

    it('should print what it removed', () => {
      expect(output.logs[1]).toContain(
        'Removed 1 resource the bus in src/bus.js no longer needs.'
      )
    })
  })

  describe('when a bus is pruned with --apply and --json', () => {
    let output: CapturedOutput
    let report: PruneReport

    beforeAll(async () => {
      output = new CapturedOutput()
      ;({ output } = await run(
        { default: configure(new PrunedQueue(output)) },
        ['src/bus.js', '--apply', '--json'],
        output
      ))
      report = JSON.parse(output.logs.join('\n')) as PruneReport
    })

    it('should print what it removes to stderr, so stdout is only the report', () => {
      expect(output.errors.join('\n')).toContain('Removing 1 resource')
    })

    it('should print the report', () => {
      expect(report).toEqual({
        formatVersion: 1,
        applied: true,
        adapters: [
          {
            adapter: 'PrunedQueue',
            resources: [
              {
                type: 'subscription',
                name: 'test/order-cancelled',
                properties: { topic: 'test/order-cancelled' }
              }
            ],
            removed: true
          }
        ]
      })
    })
  })

  describe('when a bus with nothing to prune is pruned with --apply', () => {
    let transport: PrunedQueue
    let output: CapturedOutput

    beforeAll(async () => {
      transport = new PrunedQueue()
      transport.orphaned = []
      ;({ output } = await run({ default: configure(transport) }, [
        'src/bus.js',
        '--apply'
      ]))
    })

    it('should not try to remove anything', () => {
      expect(transport.pruneCalls.map(({ apply }) => apply)).toEqual([false])
    })

    it('should say there was nothing to prune', () => {
      expect(output.logs.join('\n')).toContain('Nothing to prune')
    })
  })

  describe('when checking a bus that has something to prune', () => {
    let transport: PrunedQueue
    let exitCode: number

    beforeAll(async () => {
      transport = new PrunedQueue()
      ;({ exitCode } = await run({ default: configure(transport) }, [
        'src/bus.js',
        '--check'
      ]))
    })

    it('should exit with 3 without removing anything', () => {
      expect(exitCode).toEqual(3)
      expect(transport.pruneCalls.map(({ apply }) => apply)).toEqual([false])
    })
  })

  describe('when checking a bus that has nothing to prune', () => {
    let exitCode: number

    beforeAll(async () => {
      const transport = new PrunedQueue()
      transport.orphaned = []
      ;({ exitCode } = await run({ default: configure(transport) }, [
        'src/bus.js',
        '--check'
      ]))
    })

    it('should succeed', () => {
      expect(exitCode).toEqual(0)
    })
  })

  describe('when --check is given with --apply', () => {
    let transport: PrunedQueue
    let exitCode: number
    let output: CapturedOutput

    beforeAll(async () => {
      transport = new PrunedQueue()
      ;({ exitCode, output } = await run({ default: configure(transport) }, [
        'src/bus.js',
        '--check',
        '--apply'
      ]))
    })

    it('should fail with the usage, without pruning', () => {
      expect(exitCode).toEqual(2)
      expect(output.errors.join('\n')).toContain('Usage: bus prune <module>')
      expect(transport.pruneCalls).toEqual([])
    })
  })

  describe('when the bus is send-only', () => {
    let transport: PrunedQueue
    let exitCode: number
    let output: CapturedOutput

    beforeAll(async () => {
      transport = new PrunedQueue()
      ;({ exitCode, output } = await run(
        { default: configure(transport).asSendOnly() },
        ['src/bus.js', '--apply']
      ))
    })

    it('should refuse, saying why and what to do', () => {
      expect(exitCode).toEqual(1)
      expect(output.errors.join('\n')).toContain('is send-only')
      expect(output.errors.join('\n')).toContain('asSendOnly()')
      expect(transport.pruneCalls).toEqual([])
    })

    it('should still dispose the bus', () => {
      expect(transport.wasDisposed).toEqual(true)
    })
  })

  describe('when the bus is a scheduler', () => {
    let exitCode: number
    let output: CapturedOutput

    beforeAll(async () => {
      ;({ exitCode, output } = await run(
        {
          default: Bus.configure()
            .withLogger(() => Mock.ofType<Logger>().object)
            .withTransport(new PrunedQueue())
            .withPersistence(new InMemoryPersistence())
            .asScheduler()
        },
        ['src/bus.js']
      ))
    })

    it('should refuse', () => {
      expect(exitCode).toEqual(1)
      expect(output.errors.join('\n')).toContain('is a scheduler')
    })
  })

  describe('when the bus handles nothing', () => {
    const configureEmpty = (transport: PrunedQueue) =>
      Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(transport)

    describe('without --allow-empty', () => {
      let transport: PrunedQueue
      let exitCode: number
      let output: CapturedOutput

      beforeAll(async () => {
        transport = new PrunedQueue()
        ;({ exitCode, output } = await run(
          { default: configureEmpty(transport) },
          ['src/bus.js', '--apply']
        ))
      })

      it('should refuse, saying how to allow it', () => {
        expect(exitCode).toEqual(1)
        expect(output.errors.join('\n')).toContain('handles no message')
        expect(output.errors.join('\n')).toContain('--allow-empty')
        expect(transport.pruneCalls).toEqual([])
      })
    })

    describe('with --allow-empty', () => {
      let transport: PrunedQueue
      let exitCode: number

      beforeAll(async () => {
        transport = new PrunedQueue()
        ;({ exitCode } = await run({ default: configureEmpty(transport) }, [
          'src/bus.js',
          '--apply',
          '--allow-empty'
        ]))
      })

      it('should prune it', () => {
        expect(exitCode).toEqual(0)
        expect(transport.pruneCalls.map(({ apply }) => apply)).toEqual([
          false,
          true
        ])
      })
    })
  })

  describe('when the transport does not prune', () => {
    let output: CapturedOutput

    beforeAll(async () => {
      ;({ output } = await run({ default: configure(new InMemoryQueue()) }, [
        'src/bus.js'
      ]))
    })

    it('should say so', () => {
      expect(output.logs.join('\n')).toContain('has nothing to prune')
    })
  })

  describe('when pruning fails', () => {
    let transport: PrunedQueue
    let exitCode: number
    let output: CapturedOutput

    beforeAll(async () => {
      transport = new PrunedQueue()
      transport.failWith = Object.assign(new Error('Access denied'), {
        help: 'Grant sns:ListSubscriptions'
      })
      ;({ exitCode, output } = await run({ default: configure(transport) }, [
        'src/bus.js'
      ]))
    })

    it('should fail with the error and its help', () => {
      expect(exitCode).toEqual(1)
      expect(output.errors.join('\n')).toEqual(
        'Pruning failed: Access denied\n\nGrant sns:ListSubscriptions'
      )
    })

    it('should still dispose the bus', () => {
      expect(transport.wasDisposed).toEqual(true)
    })
  })

  describe('when the export is not a bus configuration', () => {
    let exitCode: number
    let output: CapturedOutput

    beforeAll(async () => {
      ;({ exitCode, output } = await run({ default: 42 }, ['src/bus.js']))
    })

    it('should fail, saying what to export', () => {
      expect(exitCode).toEqual(1)
      expect(output.errors.join('\n')).toContain(
        "The default export of src/bus.js isn't a bus configuration"
      )
    })
  })

  describe('when no module is given', () => {
    let exitCode: number
    let output: CapturedOutput

    beforeAll(async () => {
      ;({ exitCode, output } = await run({}, []))
    })

    it('should fail with the usage', () => {
      expect(exitCode).toEqual(2)
      expect(output.errors.join('\n')).toContain('Usage: bus prune <module>')
    })
  })

  describe('when an unknown option is given', () => {
    let exitCode: number

    beforeAll(async () => {
      ;({ exitCode } = await run({}, ['src/bus.js', '--dry-run']))
    })

    it('should fail with the usage', () => {
      expect(exitCode).toEqual(2)
    })
  })
})
