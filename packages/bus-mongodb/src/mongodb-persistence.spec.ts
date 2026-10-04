import { Bus, Logger, OutboxNotSupported } from '@node-ts/bus-core'
import { Mock } from 'typemoq'
import { MongodbPersistence } from './mongodb-persistence'

describe('MongodbPersistence', () => {
  describe('when a bus is configured with withOutbox()', () => {
    let error: unknown

    beforeAll(() => {
      // The client only connects at initialize(), so building a bus doesn't need a database
      const sut = new MongodbPersistence({
        connection: 'mongodb://localhost:27017',
        databaseName: 'workflows'
      })
      try {
        Bus.configure()
          .withLogger(() => Mock.ofType<Logger>().object)
          .withPersistence(sut)
          .withOutbox()
          .build()
      } catch (e) {
        error = e
      }
    })

    it('should throw OutboxNotSupported at build(), pointing to the issue that adds it', () => {
      expect(error).toBeInstanceOf(OutboxNotSupported)
      expect(error).toMatchObject({
        persistenceName: 'MongodbPersistence',
        help: expect.stringContaining(
          'https://github.com/node-ts/bus/issues/323'
        ) as string
      })
    })

    it('should not ask for the outbox methods to be implemented in MongodbPersistence', () => {
      expect((error as OutboxNotSupported).help).not.toContain('implement')
    })
  })
})
