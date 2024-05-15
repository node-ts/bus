import { Mock, Times } from 'typemoq'
import { ReturnMessageOutsideHandlingContext } from '../error'
import { handlerFor } from '../handler'
import { TestCommand } from '../test/test-command'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'
import { sleep } from '../util'

describe('BusInstance - Return Message', () => {
  let bus: BusInstance
  let invocationCount = 0
  const callback = Mock.ofType<() => undefined>()

  beforeAll(async () => {
    bus = Bus.configure()
      .withHandler(
        handlerFor(TestCommand, async (_: TestCommand) => {
          invocationCount++
          callback.object()

          if (invocationCount < 3) {
            await bus.returnMessage()
          }
        })
      )
      .build()

    await bus.initialize()
    await bus.start()
  })

  afterAll(async () => {
    await bus.dispose()
  })

  describe('when a message is returned to the queue during handling', () => {
    beforeAll(async () => {
      await bus.send(new TestCommand())
      while (invocationCount < 3) {
        await sleep(10)
      }
    })

    it('should be returned to the queue and retry', async () => {
      callback.verify(c => c(), Times.exactly(3))
    })
  })

  describe('when a message is returned to the queue outside of a handler', () => {
    it('should throw an error', async () => {
      await expect(bus.returnMessage()).rejects.toBeInstanceOf(
        ReturnMessageOutsideHandlingContext
      )
    })
  })
})
