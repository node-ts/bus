import { ServiceBus } from './service-bus'
import { MemoryQueue } from '../transport'
import { BusState } from './bus'
import { TestEvent } from '../test/test-event'
import { sleep } from '../util'
import { Container } from 'inversify'
import { TestContainer } from '../test/test-container'
import { BUS_SYMBOLS } from '../bus-symbols'

const event = new TestEvent()

describe('ServiceBus', () => {
  let container: Container

  let sut: ServiceBus
  let queue: MemoryQueue

  beforeAll(() => {
    container = new TestContainer()

    queue = new MemoryQueue()

    sut = container.get(BUS_SYMBOLS.Bus)
  })

  describe('when starting the service bus', () => {
    beforeAll(async () => {
      await sut.start()
    })

    afterAll(async () => {
      await sut.stop()
    })

    it('should complete into a started state', () => {
      expect(sut.state).toEqual(BusState.Started)
    })

    describe('and then the bus is started again', () => {
      it('should throw an error', async () => {
        await expect(sut.start()).rejects.toThrowError()
      })
    })

    describe('and a message is received on the queue', () => {
      beforeAll(async () => {
        await sut.publish(event)
        await sleep(1)
      })

      it('should delete the message from the queue', () => {
        expect(queue.depth).toEqual(0)
      })
    })
  })
})
