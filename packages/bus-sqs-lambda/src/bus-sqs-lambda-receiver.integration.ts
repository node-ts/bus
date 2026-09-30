import {
  Bus,
  BusInstance,
  HandlerDispatchRejected,
  handlerFor,
  Logger
} from '@node-ts/bus-core'
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda'
import { Mock } from 'typemoq'
import { BusSqsLambdaReceiver } from './bus-sqs-lambda-receiver'
import { BusSqsLambdaReceiverConfiguration } from './bus-sqs-lambda-receiver-configuration'
import { TestCommand, toSqsRecord, UnhandledCommand } from './test'

const event: SQSEvent = {
  Records: [
    toSqsRecord(new TestCommand(), 'succeeds'),
    toSqsRecord(new TestCommand(true), 'fails'),
    toSqsRecord(new UnhandledCommand(), 'unhandled')
  ]
}

const buildBus = async (
  configuration?: BusSqsLambdaReceiverConfiguration
): Promise<BusInstance> => {
  const bus = Bus.configure()
    .withReceiver(new BusSqsLambdaReceiver(configuration))
    .withHandler(
      handlerFor(TestCommand, (command: TestCommand) => {
        if (command.shouldFail) {
          throw new Error('Handler failed')
        }
      })
    )
    .withLogger(() => Mock.ofType<Logger>().object)
    .build()
  await bus.initialize()
  return bus
}

describe('BusSqsLambdaReceiver', () => {
  describe('when a batch with a failing record is received', () => {
    describe('with reportBatchItemFailures enabled', () => {
      let bus: BusInstance
      let response: SQSBatchResponse

      beforeAll(async () => {
        bus = await buildBus({ reportBatchItemFailures: true })
        response = await bus.receive<SQSBatchResponse>(event)
      })

      afterAll(async () => {
        await bus.dispose()
      })

      it('should report only the failed record', () => {
        expect(response).toEqual({
          batchItemFailures: [{ itemIdentifier: 'fails' }]
        })
      })
    })

    describe('without reportBatchItemFailures enabled', () => {
      let bus: BusInstance
      let result: Promise<unknown>

      beforeAll(async () => {
        bus = await buildBus()
        result = bus.receive(event)
        // Avoid an unhandled rejection before the assertion awaits it
        result.catch(() => undefined)
      })

      afterAll(async () => {
        await bus.dispose()
      })

      it('should reject so that Lambda retries the whole batch', async () => {
        await expect(result).rejects.toBeInstanceOf(HandlerDispatchRejected)
      })
    })
  })
})
