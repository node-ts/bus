import { MemoryQueue } from '../transport'
import { Bus } from './bus'
import { TestEvent } from '../test/test-event'
import { sleep } from '../util'
import { Mock, IMock } from 'typemoq'
import { BusInstance } from './bus-instance'

const event = new TestEvent()
type Callback = () => void;

describe('BusInstance - Concurrency', () => {
  let queue: MemoryQueue
  let callback: IMock<Callback>
  let handleCount = 0
  const resolutions: ((_: unknown) => void)[] = []
  const CONCURRENCY = 2
  let bus: BusInstance

  const handler = async () => {
    handleCount++
    await new Promise(resolve => {
      resolutions.push(resolve)
    })
  }

  beforeAll(async () => {
    queue = new MemoryQueue()
    callback = Mock.ofType<Callback>()

    bus =await Bus.configure()
      .withTransport(queue)
      .withHandler(TestEvent, handler)
      .withConcurrency(CONCURRENCY)
      .initialize()
    await bus.start()
  })

  afterAll(async () => bus.stop())

  describe('when starting the bus with concurrent handlers', () => {
    beforeAll(async () => {
      // These should be handled immediately
      await bus.publish(event)
      await bus.publish(event)

      // This should be handled when the next worker becomes available
      await bus.publish(event)
      await sleep(100)
    })

    it('should handle messages in parallel up to the concurrency limit', async () => {
      expect(handleCount).toEqual(CONCURRENCY)

      resolutions[0](undefined)
      await sleep(10)
      expect(handleCount).toEqual(CONCURRENCY + 1)
      resolutions[1](undefined)
      resolutions[2](undefined)
    })
  })

})
