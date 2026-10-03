import { TransportHeaderReserved } from '@node-ts/bus-core'
import { RabbitMqTransport } from './rabbitmq-transport'
import { TestCommand } from './test'

const reservedHeaderNames = [
  'attributes',
  'stickyAttributes',
  'sentAt',
  'failedAttempts',
  'x-death',
  'x-first-death-reason',
  'x-last-death-queue'
]

describe('RabbitMqTransport', () => {
  // The headers are checked before the transport connects, so no broker is needed
  const sut = new RabbitMqTransport({
    queueName: '@node-ts/bus-rabbitmq-reserved-header-test',
    connectionString: 'amqp://guest:guest@0.0.0.0'
  })

  describe.each(reservedHeaderNames)(
    'when checking send options with a header named %s',
    headerName => {
      let error: unknown

      beforeEach(() => {
        try {
          sut.assertSendOptions({ headers: { [headerName]: 'value' } })
        } catch (e) {
          error = e
        }
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

  describe.each(reservedHeaderNames)(
    'when sending a message with a header named %s',
    headerName => {
      let error: unknown

      beforeEach(async () => {
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
      })
    }
  )

  describe('when checking send options with headers the broker does not write', () => {
    let error: unknown

    beforeEach(() => {
      try {
        sut.assertSendOptions({ headers: { 'x-tenant': 'acme', 'x-delay': 5 } })
      } catch (e) {
        error = e
      }
    })

    it('should accept them', () => {
      expect(error).toBeUndefined()
    })
  })
})
