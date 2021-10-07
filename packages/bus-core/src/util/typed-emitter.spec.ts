import { TypedEmitter, Unsubscribe } from './typed-emitter'
import { Mock, IMock, Times } from 'typemoq'

describe('TypedEmitter', () => {
  let sut: TypedEmitter<string>

  beforeEach(() => {
    sut = new TypedEmitter()
  })

  describe('when subscribing via .once()', () => {
    const callback = Mock.ofType<(event: string) => void>()
    beforeEach(() => {
      sut.once(callback.object)
      sut.emit('one')
      sut.emit('one')
    })

    it('should only receive the first event', () => {
      callback.verify(
        invocation => invocation('one'),
        Times.once()
      )
    })
  })

  describe('when piping', () => {
    const destinationTypedEmitter = new TypedEmitter<string>()
    const callback = Mock.ofType<(event: string) => void>()

    beforeEach(() => {
      sut.pipe(destinationTypedEmitter)
      destinationTypedEmitter.once(callback.object)
      sut.emit('one')
    })

    it('should pipe events through', () => {
      callback.verify(
        invocation => invocation('one'),
        Times.once()
      )
    })
  })

  describe('when unsubscribing via .off()', () => {
    const callback = Mock.ofType<(event: string) => void>()
    beforeEach(() => {
      sut.on(callback.object)
      sut.off(callback.object)
      sut.emit('one')
    })

    it('should not receive any events', () => {
      callback.verify(
        invocation => invocation('one'),
        Times.never()
      )
    })
  })

  describe('when subscribing via .on()', () => {
    let callback: IMock<(event: string) => void>
    let unsubscribe: Unsubscribe

    beforeEach(() => {
      callback = Mock.ofType<(event: string) => void>()
      unsubscribe = sut.on(callback.object)

      sut.emit('one')
      sut.emit('one')
    })

    it('should receive all emitted events', () => {
      callback.verify(
        invocation => invocation('one'),
        Times.exactly(2)
      )
    })

    describe('when unsubscribing', () => {
      beforeEach(() => {
        unsubscribe()
        callback.reset()
        sut.emit('one')
      })

      it('should not receive subsequent events', () => {
        callback.verify(
          invocation => invocation('one'),
          Times.never()
        )
      })
    })
  })
})
