import { MessageTypeReferenceNotFound, MessageTypesConflict } from './error'
import { mergeMessageTypes } from './merge-message-types'
import { MessageTypes } from './message-types'

class CustomerA {}
class CustomerB {}

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

const thrownBy = (merge: () => void): unknown => {
  try {
    merge()
  } catch (error) {
    return error
  }
  return undefined
}

describe('mergeMessageTypes', () => {
  describe('when merging several libraries', () => {
    let sut: MessageTypes

    beforeAll(() => {
      sut = mergeMessageTypes([libraryA, libraryB])
    })

    it('should merge them', () => {
      expect(Object.keys(sut.messages)).toEqual(['a/message', 'b/message'])
      expect(sut.types['library-b/src/customer#Customer'].class).toBe(CustomerB)
    })

    it('should not change the message types it was given', () => {
      expect(Object.keys(libraryA.messages)).toEqual(['a/message'])
    })
  })

  describe('when merging the same message types twice', () => {
    let sut: MessageTypes
    let error: unknown

    beforeAll(() => {
      error = thrownBy(() => {
        sut = mergeMessageTypes([libraryA, libraryA])
      })
    })

    it('should merge them once', () => {
      expect(error).toBeUndefined()
      expect(Object.keys(sut.messages)).toEqual(['a/message'])
    })
  })

  describe('when merging nothing', () => {
    it('should return empty message types', () => {
      expect(mergeMessageTypes([])).toEqual({ messages: {}, types: {} })
    })
  })

  describe('when two libraries map a $name to different types', () => {
    let error: unknown

    beforeAll(() => {
      error = thrownBy(() =>
        mergeMessageTypes([
          libraryA,
          {
            ...libraryB,
            messages: { 'a/message': 'library-b/src/message#MessageB' }
          }
        ])
      )
    })

    it('should throw MessageTypesConflict naming both sources', () => {
      expect(error).toBeInstanceOf(MessageTypesConflict)
      const conflict = error as MessageTypesConflict
      expect(conflict.kind).toEqual('$name')
      expect(conflict.key).toEqual('a/message')
      expect(conflict.sources).toEqual([libraryA.source, libraryB.source])
      expect(conflict.message).toContain(libraryA.source)
      expect(conflict.message).toContain(libraryB.source)
    })
  })

  describe('when two libraries define a type key differently', () => {
    let error: unknown

    beforeAll(() => {
      error = thrownBy(() =>
        mergeMessageTypes([
          libraryA,
          {
            source: 'other',
            messages: {},
            types: {
              'library-a/src/customer#Customer': {
                class: CustomerB,
                fields: {}
              }
            }
          }
        ])
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
      error = thrownBy(() =>
        mergeMessageTypes([
          {
            messages: {},
            types: { A: { fields: { b: { array: { type: 'B' } } } } }
          }
        ])
      )
    })

    it('should throw MessageTypeReferenceNotFound', () => {
      expect(error).toBeInstanceOf(MessageTypeReferenceNotFound)
    })
  })
})
