import { MemoryQueue } from '../transport'
import { Bus, BusState } from './bus'
import { TestEvent } from '../test/test-event'
import { sleep } from '../util'
import { Logger } from '@node-ts/logger-core'
import { Mock, IMock, Times } from 'typemoq'

const event = new TestEvent()
type Callback = () => void

describe('ServiceBus', () => {
  let queue: MemoryQueue
  let callback: IMock<Callback>
  const handler = async (_: TestEvent) => callback.object()

  beforeAll(async () => {
    queue = new MemoryQueue()
    callback = Mock.ofType<Callback>()

    await Bus.configure()
      .withTransport(queue)
      .withLogger(Mock.ofType<Logger>().object)
      .withHandler(TestEvent, handler)
      .initialize()
  })

  describe('when starting the service bus', () => {
    it('should complete into a started state', async () => {
      await Bus.start()
      expect(Bus.state).toEqual(BusState.Started)
      await Bus.stop()
    })

    describe('and then the bus is started again', () => {
      it('should throw an error', async () => {
        await Bus.start()
        await expect(Bus.start()).rejects.toThrowError()
        await Bus.stop()
      })
    })
  })

  describe('when stopping the service bus', () => {
    describe('when its started', () => {
      it('should stop the bus', async () => {
        await Bus.start()
        await Bus.stop()
        expect(Bus.state).toEqual(BusState.Stopped)
      })
    })

    describe('when its not started', () => {
      it('should throw an error', async () => {
        await expect(Bus.stop()).rejects.toThrowError()
      })
    })
  })


  describe('when a message is successfully handled from the queue', () => {
    beforeEach(async () => Bus.start())
    afterEach(async () => Bus.stop())

    it('should delete the message from the queue', async () => {
      callback.reset()
      callback
        .setup(c => c())
        .callback(() => undefined)
        .verifiable(Times.once())
      await Bus.publish(event)
      await sleep(10)

      expect(queue.depth).toEqual(0)
      callback.verifyAll()
    })
  })

  describe('and a handled message throws an Error', () => {
    beforeEach(async () => Bus.start())
    afterEach(async () => Bus.stop())

    it('should return the message for retry', async () => {
      callback.reset()
      let callCount = 0
      callback
        .setup(c => c())
        .callback(() => {
          if (callCount++ === 0) {
            throw new Error()
          }
        })
        .verifiable(Times.exactly(2))

      await Bus.publish(event)
      await sleep(2000)

      callback.verifyAll()
    })
  })
})
