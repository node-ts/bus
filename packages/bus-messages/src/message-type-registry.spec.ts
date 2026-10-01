import { MessageTypeReferenceNotFound, MessageTypesConflict } from './error'
import { getMessageTypes, registerMessageTypes } from './message-type-registry'
import { MessageTypes } from './message-types'

class CustomerA {}
class CustomerB {}

const REGISTRY_KEY = Symbol.for('@node-ts/bus/message-types')

const resetRegistry = (): void => {
  delete (globalThis as { [key: symbol]: unknown })[REGISTRY_KEY]
}

const libraryA: MessageTypes = {
  source: 'library-a/src/message-types.generated',
  messages: { 'a/message': 'library-a/src/message#MessageA' },
  types: {
    'library-a/src/message#MessageA': {
      fields: { customer: { type: 'library-a/src/customer#Customer' } }
    },
    'library-a/src/customer#Customer': {
      class: CustomerA,
      fields: { joinedAt: 'Date' }
    }
  }
}

const libraryB: MessageTypes = {
  source: 'library-b/src/message-types.generated',
  messages: { 'b/message': 'library-b/src/message#MessageB' },
  types: {
    'library-b/src/message#MessageB': {
      fields: { customer: { type: 'library-b/src/customer#Customer' } }
    },
    'library-b/src/customer#Customer': {
      class: CustomerB,
      fields: { leftAt: 'Date' }
    }
  }
}

const thrownBy = (register: () => void): unknown => {
  try {
    register()
  } catch (error) {
    return error
  }
  return undefined
}

describe('registerMessageTypes', () => {
  afterAll(() => resetRegistry())

  describe('when registering several libraries', () => {
    beforeAll(() => {
      resetRegistry()
      registerMessageTypes(libraryA)
      registerMessageTypes(libraryB)
    })

    it('should merge them', () => {
      expect(Object.keys(getMessageTypes().messages)).toEqual([
        'a/message',
        'b/message'
      ])
      expect(
        getMessageTypes().types['library-b/src/customer#Customer'].class
      ).toBe(CustomerB)
    })
  })

  describe('when registering the same message types twice', () => {
    let error: unknown

    beforeAll(() => {
      resetRegistry()
      registerMessageTypes(libraryA)
      error = thrownBy(() => registerMessageTypes(libraryA))
    })

    it('should do nothing', () => {
      expect(error).toBeUndefined()
      expect(Object.keys(getMessageTypes().messages)).toEqual(['a/message'])
    })
  })

  describe('when registering message types with the same source again', () => {
    class ReloadedCustomer {}

    beforeAll(() => {
      resetRegistry()
      registerMessageTypes(libraryA)
      // A reloaded module declares new classes for the same types
      registerMessageTypes({
        ...libraryA,
        types: {
          ...libraryA.types,
          'library-a/src/customer#Customer': {
            class: ReloadedCustomer,
            fields: { joinedAt: 'Date' }
          }
        }
      })
    })

    it('should replace them', () => {
      expect(
        getMessageTypes().types['library-a/src/customer#Customer'].class
      ).toBe(ReloadedCustomer)
    })
  })

  describe('when two sources map a $name to different types', () => {
    let error: unknown

    beforeAll(() => {
      resetRegistry()
      registerMessageTypes(libraryA)
      error = thrownBy(() =>
        registerMessageTypes({
          ...libraryB,
          messages: { 'a/message': 'library-b/src/message#MessageB' }
        })
      )
    })

    it('should throw MessageTypesConflict', () => {
      expect(error).toBeInstanceOf(MessageTypesConflict)
      expect((error as MessageTypesConflict).kind).toEqual('$name')
    })

    it('should keep what was registered before', () => {
      expect(getMessageTypes().messages['a/message']).toEqual(
        'library-a/src/message#MessageA'
      )
      expect(
        getMessageTypes().types['library-b/src/customer#Customer']
      ).toBeUndefined()
    })
  })

  describe('when two sources define a type key differently', () => {
    let error: unknown

    beforeAll(() => {
      resetRegistry()
      registerMessageTypes(libraryA)
      error = thrownBy(() =>
        registerMessageTypes({
          source: 'other',
          messages: {},
          types: {
            'library-a/src/customer#Customer': {
              class: CustomerB,
              fields: {}
            }
          }
        })
      )
    })

    it('should throw MessageTypesConflict', () => {
      expect(error).toBeInstanceOf(MessageTypesConflict)
      expect((error as MessageTypesConflict).kind).toEqual('type')
    })
  })

  describe('when message types refer to a type they do not define', () => {
    let error: unknown

    beforeAll(() => {
      resetRegistry()
      error = thrownBy(() =>
        registerMessageTypes({
          messages: {},
          types: { A: { fields: { b: { array: { type: 'B' } } } } }
        })
      )
    })

    it('should throw MessageTypeReferenceNotFound', () => {
      expect(error).toBeInstanceOf(MessageTypeReferenceNotFound)
    })
  })

  describe('when two copies of the package are loaded', () => {
    let fromOtherCopy: MessageTypes

    beforeAll(() => {
      resetRegistry()
      registerMessageTypes(libraryA)
      jest.isolateModules(() => {
        // A fresh module instance, as when two versions of the package are installed
        const otherCopy = jest.requireActual<
          typeof import('./message-type-registry')
        >('./message-type-registry')
        otherCopy.registerMessageTypes(libraryB)
        fromOtherCopy = otherCopy.getMessageTypes()
      })
    })

    it('should share one registry', () => {
      expect(Object.keys(fromOtherCopy.messages)).toEqual([
        'a/message',
        'b/message'
      ])
      expect(Object.keys(getMessageTypes().messages)).toEqual([
        'a/message',
        'b/message'
      ])
    })
  })
})
