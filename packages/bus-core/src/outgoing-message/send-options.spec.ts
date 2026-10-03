import { HandlerContext } from '../handler'
import { TestCommand } from '../test/test-command'
import { SendOptions } from './send-options'

describe('SendOptions', () => {
  describe('when deliverAfter is given with attributes', () => {
    it('should compile', () => {
      const options: SendOptions = {
        deliverAfter: 1_000,
        correlationId: 'correlation',
        attributes: { tenant: 'a' }
      }
      expect(options.deliverAfter).toEqual(1_000)
    })
  })

  describe('when deliverAt is given', () => {
    it('should compile', () => {
      const deliverAt = new Date()
      const options: SendOptions = { deliverAt }
      expect(options.deliverAt).toBe(deliverAt)
    })
  })

  describe('when deliverAfter and deliverAt are given together', () => {
    it('should not compile', () => {
      // @ts-expect-error deliverAfter and deliverAt can't be given together
      const options: SendOptions = { deliverAfter: 1, deliverAt: new Date() }
      expect(options).toBeDefined()
    })
  })

  describe('when deliverAfter is not a number', () => {
    it('should not compile', () => {
      // @ts-expect-error deliverAfter is a number of milliseconds
      const options: SendOptions = { deliverAfter: '1s' }
      expect(options).toBeDefined()
    })
  })

  describe('when a handler context sends with a delay', () => {
    it('should compile', async () => {
      const sent: SendOptions[] = []
      const ctx: Pick<HandlerContext, 'send' | 'publish'> = {
        send: async (_command, options) => {
          sent.push(options ?? {})
        },
        publish: async () => undefined
      }
      await ctx.send(new TestCommand(), { deliverAfter: 5 })
      await ctx.send(new TestCommand(), {
        deliverAfter: 5,
        // @ts-expect-error deliverAfter and deliverAt can't be given together
        deliverAt: new Date()
      })
      expect(sent[0]).toEqual({ deliverAfter: 5 })
    })
  })
})
