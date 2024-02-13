import { InMemoryQueue } from '../transport'
import { Bus } from './bus'
import { TestEvent } from '../test/test-event'
import { sleep } from '../util'
import { Mock, IMock, Times } from 'typemoq'
import { BusInstance } from './bus-instance'
import { handlerFor } from '../handler'
import { TestCommand } from '../test/test-command'

const event = new TestEvent()
type Callback = (correlationId: string) => void

describe('BusInstance - Concurrency', () => {
  let queue: InMemoryQueue
  let callback: IMock<Callback>
  let handleCount = 0
  const resolutions: ((_: unknown) => void)[] = []
  const CONCURRENCY = 2
  let bus: BusInstance

  const eventHandler = handlerFor(TestEvent, async () => {
    handleCount++

    await new Promise(resolve => {
      resolutions.push(resolve)
    })
    await bus.send(new TestCommand())
  })

  const commandHandler = handlerFor(TestCommand, async (_, attributes) => {
    callback.object(attributes.correlationId!)
  })

  beforeAll(async () => {
    queue = new InMemoryQueue()
    callback = Mock.ofType<Callback>()

    bus = Bus.configure()
      .withTransport(queue)
      .withHandler(eventHandler)
      .withHandler(commandHandler)
      .withConcurrency(CONCURRENCY)
      .build()

    await bus.initialize()
    await bus.start()
  })

  afterAll(async () => bus.stop())

  describe('when starting the bus with concurrent handlers', () => {
    beforeAll(async () => {
      await Promise.all([
        // These should be handled immediately
        bus.publish(event, { correlationId: 'first' }),
        bus.publish(event, { correlationId: 'second' }),
        // This should be handled when the next worker becomes available
        bus.publish(event, { correlationId: 'third' })
      ])
      await sleep(100)
    })

    it('should handle messages in parallel up to the concurrency limit', async () => {
      expect(handleCount).toEqual(CONCURRENCY)

      // Let the first handler complete
      resolutions[0](undefined)
      await sleep(10)

      expect(handleCount).toEqual(CONCURRENCY + 1)
      // Resolve subsequent handlers
      resolutions[1](undefined)
      resolutions[2](undefined)
    })

    describe('when the command handlers are run', () => {
      it('the message handling context should have propagated all sticky attributes', () => {
        callback.verify(x => x('first'), Times.once())
        callback.verify(x => x('second'), Times.once())
        callback.verify(x => x('third'), Times.once())
      })
    })
  })
})
