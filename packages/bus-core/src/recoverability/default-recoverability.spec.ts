import { DelayedReplyNotSupported, ReturnAddressMissing } from '../error'
import { HandlerDispatchRejected } from '../handler/error'
import { TestCommand } from '../test'
import {
  EndpointNotFound,
  TransportReplyNotSupported
} from '../transport/error'
import { WorkflowHandlerFailed } from '../workflow/error'
import { defaultRecoverability } from './default-recoverability'
import { MessageHandlingFailure } from './message-handling-failure'
import { deadLetter, retry } from './recoverability-action'

class ValidationError extends Error {}

const failure = (
  failedAttempts: number,
  error: unknown = new Error('Handler failed')
): MessageHandlingFailure => ({
  error,
  message: new TestCommand(),
  attributes: { attributes: {}, stickyAttributes: {} },
  failedAttempts
})

describe('defaultRecoverability', () => {
  describe('without options', () => {
    const sut = defaultRecoverability()

    it.each([
      [1, 5, 6],
      [2, 23, 28],
      [5, 2813, 3438],
      [8, 351563, 429688]
    ])(
      'should retry failure %s after between %sms and %sms',
      (failedAttempts, minDelay, maxDelay) => {
        const action = sut(failure(failedAttempts))
        expect(action.action).toEqual('retry')
        const { delay } = action as { delay: number }
        expect(delay).toBeGreaterThanOrEqual(minDelay)
        expect(delay).toBeLessThanOrEqual(maxDelay)
      }
    )

    it('should dead-letter the message on its 10th failure', () => {
      expect(sut(failure(10))).toEqual(deadLetter())
    })
  })

  describe('with maxAttempts', () => {
    const sut = defaultRecoverability({ maxAttempts: 3, delay: 100 })

    it('should retry until the message has been attempted maxAttempts times', () => {
      expect(sut(failure(1))).toEqual(retry(100))
      expect(sut(failure(2))).toEqual(retry(100))
    })

    it('should dead-letter it on the last attempt', () => {
      expect(sut(failure(3))).toEqual(deadLetter())
    })
  })

  describe('with a delay function', () => {
    const sut = defaultRecoverability({
      delay: failedAttempts => failedAttempts * 1_000
    })

    it('should call it with the failed attempts', () => {
      expect(sut(failure(4))).toEqual(retry(4_000))
    })
  })

  describe('with unrecoverable errors', () => {
    const sut = defaultRecoverability({ unrecoverable: [ValidationError] })

    it('should dead-letter a message that fails with one on its first failure', () => {
      expect(sut(failure(1, new ValidationError()))).toEqual(deadLetter())
    })

    it('should find one thrown by a handler', () => {
      const error = new HandlerDispatchRejected([
        new Error('Other handler failed'),
        new ValidationError()
      ])
      expect(sut(failure(1, error))).toEqual(deadLetter())
    })

    it('should find one thrown by a workflow handler', () => {
      const error = new HandlerDispatchRejected([
        new WorkflowHandlerFailed(
          'order-workflow',
          'workflow-id',
          TestCommand.NAME,
          new ValidationError()
        )
      ])
      expect(sut(failure(1, error))).toEqual(deadLetter())
    })

    it('should retry other errors', () => {
      expect(sut(failure(1, new Error())).action).toEqual('retry')
    })
  })

  describe.each([
    ['DelayedReplyNotSupported', new DelayedReplyNotSupported('reply')],
    ['ReturnAddressMissing', new ReturnAddressMissing('request', 'reply')],
    [
      'TransportReplyNotSupported',
      new TransportReplyNotSupported('MyTransport', 'reply')
    ],
    ['EndpointNotFound', new EndpointNotFound('requester', 'MyTransport')]
  ])('when a reply fails with %s', (_, replyError) => {
    const sut = defaultRecoverability({ unrecoverable: [ValidationError] })

    it('should dead-letter the message on its first failure, since retrying can never succeed', () => {
      expect(
        sut(failure(1, new HandlerDispatchRejected([replyError])))
      ).toEqual(deadLetter())
    })
  })
})
