import { TransportHeaderReserved } from '@node-ts/bus-core'
import { RabbitMqTransport } from './rabbitmq-transport'
import { TestCommand } from './test'

describe('RabbitMqTransport', () => {
  describe.each(['attributes', 'stickyAttributes', 'sentAt', 'failedAttempts'])(
    'when sending a message with a header named %s',
    headerName => {
      let error: unknown

      beforeEach(async () => {
        // The headers are checked before the transport connects, so no broker is needed
        const sut = new RabbitMqTransport({
          queueName: '@node-ts/bus-rabbitmq-reserved-header-test',
          connectionString: 'amqp://guest:guest@0.0.0.0'
        })
        error = await sut
          .send(
            new TestCommand('reserved'),
            { attributes: {}, stickyAttributes: {} },
            { headers: { [headerName]: 'value' } }
          )
          .catch((e: unknown) => e)
      })

      it('should throw TransportHeaderReserved', () => {
        expect(error).toBeInstanceOf(TransportHeaderReserved)
        expect(error).toMatchObject({
          headerName,
          transportName: 'RabbitMqTransport'
        })
      })
    }
  )
})
