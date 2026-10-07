import { Scope } from '@nestjs/common'
import { ContextId, ModuleRef } from '@nestjs/core'
import { ContainerAdapter } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { Mock } from 'typemoq'
import { BusRequest } from './bus-request'
import { BusClassNotProvided, WorkflowResolvedWithoutMessage } from './error'
import { nestContainer } from './nest-container'
import { OrderPlaced } from './test/order-placed'

class SingletonHandler {}
class ScopedHandler {}
class MissingHandler {}

/**
 * The part of a `ModuleRef` the adapter uses, recording how it's called
 */
class FakeModuleRef {
  readonly singleton = new SingletonHandler()
  readonly resolvedIn: ContextId[] = []
  readonly requests: BusRequest[] = []

  /**
   * @param failToResolveWith an error to reject with when resolving a request-scoped provider
   */
  constructor(private readonly failToResolveWith?: Error) {}

  introspect(type: unknown): { scope: Scope } {
    if (type === SingletonHandler) {
      return { scope: Scope.DEFAULT }
    }
    if (type === ScopedHandler) {
      return { scope: Scope.REQUEST }
    }
    throw new Error('Nest could not find MissingHandler element')
  }

  get(type: unknown): unknown {
    return type === SingletonHandler ? this.singleton : undefined
  }

  async resolve(_type: unknown, contextId: ContextId): Promise<unknown> {
    this.resolvedIn.push(contextId)
    if (this.failToResolveWith) {
      throw this.failToResolveWith
    }
    return new ScopedHandler()
  }

  registerRequestByContextId(request: BusRequest): void {
    this.requests.push(request)
  }
}

describe('nestContainer', () => {
  describe('when a singleton is resolved', () => {
    const moduleRef = new FakeModuleRef()
    let resolved: unknown

    beforeAll(async () => {
      const sut = nestContainer(moduleRef as unknown as ModuleRef)
      resolved = await sut.get(SingletonHandler, {
        message: new OrderPlaced('order-1')
      })
    })

    it('should get it from the container without a request scope', () => {
      expect(resolved).toBe(moduleRef.singleton)
      expect(moduleRef.resolvedIn).toEqual([])
      expect(moduleRef.requests).toEqual([])
    })
  })

  describe('when a request-scoped provider is resolved for the handlers of messages', () => {
    const moduleRef = new FakeModuleRef()
    const message = new OrderPlaced('order-1')
    const attributes = Mock.ofType<MessageAttributes>().object

    beforeAll(async () => {
      const sut: ContainerAdapter = nestContainer(
        moduleRef as unknown as ModuleRef
      )
      await sut.get(ScopedHandler, { message, messageAttributes: attributes })
      await sut.get(ScopedHandler, { message, messageAttributes: attributes })
      await sut.get(ScopedHandler, { message: new OrderPlaced('order-2') })
      await sut.get(ScopedHandler)
    })

    it('should resolve the handlers of one message in one request scope', () => {
      const [first, second, third, fourth] = moduleRef.resolvedIn
      expect(first).toBe(second)
      expect(third).not.toBe(first)
      expect(fourth).not.toBe(first)
      expect(fourth).not.toBe(third)
    })

    it('should register each message and its attributes as the request once', () => {
      expect(moduleRef.requests).toHaveLength(2)
      expect(moduleRef.requests[0]).toEqual({ message, attributes })
    })
  })

  describe('when a request-scoped class fails to resolve without a message', () => {
    const cause = new TypeError(
      "Cannot read properties of undefined (reading 'message')"
    )
    let error: unknown

    beforeAll(async () => {
      const sut = nestContainer(
        new FakeModuleRef(cause) as unknown as ModuleRef
      )
      try {
        await sut.get(ScopedHandler)
      } catch (e) {
        error = e
      }
    })

    it('should throw WorkflowResolvedWithoutMessage, naming the class, with the error as its cause', () => {
      expect(error).toBeInstanceOf(WorkflowResolvedWithoutMessage)
      expect((error as WorkflowResolvedWithoutMessage).className).toEqual(
        'ScopedHandler'
      )
      expect((error as WorkflowResolvedWithoutMessage).cause).toBe(cause)
    })
  })

  describe('when a request-scoped class fails to resolve for a message', () => {
    const cause = new Error('Database unavailable')
    let error: unknown

    beforeAll(async () => {
      const sut = nestContainer(
        new FakeModuleRef(cause) as unknown as ModuleRef
      )
      try {
        await sut.get(ScopedHandler, { message: new OrderPlaced('order-1') })
      } catch (e) {
        error = e
      }
    })

    it('should rethrow the error as it is', () => {
      expect(error).toBe(cause)
    })
  })

  describe('when a class is not a provider', () => {
    let error: unknown

    beforeAll(async () => {
      const sut = nestContainer(new FakeModuleRef() as unknown as ModuleRef)
      try {
        await sut.get(MissingHandler)
      } catch (e) {
        error = e
      }
    })

    it('should throw BusClassNotProvided, naming the class', () => {
      expect(error).toBeInstanceOf(BusClassNotProvided)
      expect((error as BusClassNotProvided).className).toEqual('MissingHandler')
      expect((error as BusClassNotProvided).cause).toBeInstanceOf(Error)
    })
  })
})
