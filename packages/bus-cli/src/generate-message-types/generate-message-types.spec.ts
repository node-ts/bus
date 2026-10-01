import { join } from 'node:path'
import { MessageTypeGenerationFailed } from './error'
import {
  GeneratedMessageTypes,
  generateMessageTypes
} from './generate-message-types'

const TEST_DIRECTORY = join(__dirname, '..', '..', 'test')
const SUPPORTED = join(TEST_DIRECTORY, 'supported')
const UNSUPPORTED = join(TEST_DIRECTORY, 'unsupported')

const generationError = (cwd: string): MessageTypeGenerationFailed => {
  try {
    generateMessageTypes({ cwd })
  } catch (error) {
    return error as MessageTypeGenerationFailed
  }
  throw new Error('Expected generation to fail')
}

describe('generateMessageTypes', () => {
  describe('when generating for supported types', () => {
    let sut: GeneratedMessageTypes

    beforeAll(() => {
      sut = generateMessageTypes({ cwd: SUPPORTED })
    })

    it('should write to the default file', () => {
      expect(sut.outFile).toEqual(
        join(SUPPORTED, 'src', 'message-types.generated.ts')
      )
    })

    it('should map every exported, non-abstract class with a $name', () => {
      expect(sut.messageCount).toEqual(4)
      expect(sut.content).toContain(`  messages: {
    'fixture/order-state': 'OrderState',
    'fixture/ping': 'Ping',
    'fixture/place-order': 'PlaceOrder',
    'fixture/pong': 'Pong'
  },`)
    })

    it('should import each class from the file that declares it', () => {
      expect(sut.content).toContain(
        "import { Line, PlaceOrder } from './place-order.js'"
      )
      expect(sut.content).toContain(
        "import { OrderState, Ping, Pong } from './literal-names.js'"
      )
    })

    it('should import classes with the same name under different names', () => {
      expect(sut.content).toContain("import { Address } from './address.js'")
      expect(sut.content).toContain(
        "import { Address as Address_2 } from './other/address.js'"
      )
    })

    it('should describe every field that needs restoring', () => {
      expect(sut.content).toContain(`    PlaceOrder: {
      class: PlaceOrder,
      fields: {
        placedAt: 'Date',
        shipTo: { type: 'Address' },
        billTo: { type: 'Address_2' },
        lines: { array: { type: 'Line' } },
        reminders: { array: 'Date' },
        nested: { array: { array: 'Date' } },
        byId: { map: { type: 'Line' } },
        counts: { map: 'plain', keys: 'number' },
        labels: { map: 'plain' },
        tags: { set: 'plain' },
        dates: { set: 'Date' },
        total: 'BigInt',
        audit: { type: 'Audit' },
        history: { array: { type: 'Audit' } },
        meta: { type: 'PlaceOrder.meta' },
        lookup: { record: 'Date' },
        cancelledAt: 'Date',
        tree: { type: 'TreeNode' }
      }
    },`)
    })

    it('should describe object types without a class', () => {
      expect(sut.content).toContain(`    Audit: {
      fields: {
        at: 'Date'
      }
    },`)
      expect(sut.content).toContain(`    'PlaceOrder.meta': {
      fields: {
        seenAt: 'Date'
      }
    },`)
    })

    it('should describe recursive classes', () => {
      expect(sut.content).toContain(`    TreeNode: {
      class: TreeNode,
      fields: {
        createdAt: 'Date',
        children: { array: { type: 'TreeNode' } },
        parent: { type: 'TreeNode' }
      }
    }`)
    })

    it('should skip getters, methods and #private fields', () => {
      expect(sut.content).toContain(`    GeoPoint: {
      class: GeoPoint,
      fields: {
        surveyedAt: 'Date'
      }
    },`)
    })
  })

  describe('when the project resolves modules like a bundler', () => {
    let sut: GeneratedMessageTypes

    beforeAll(() => {
      sut = generateMessageTypes({
        cwd: SUPPORTED,
        project: 'tsconfig.bundler.json'
      })
    })

    it('should import without a file extension', () => {
      expect(sut.content).toContain("import { Address } from './address'")
    })
  })

  describe('when generating for some of the files', () => {
    let sut: GeneratedMessageTypes

    beforeAll(() => {
      sut = generateMessageTypes({
        cwd: SUPPORTED,
        entry: ['src/**/*.ts'],
        exclude: ['src/place-order.ts'],
        out: 'generated/types.ts'
      })
    })

    it('should only include classes declared in those files', () => {
      expect(sut.messageCount).toEqual(3)
      expect(sut.content).not.toContain('PlaceOrder')
    })

    it('should import relative to the generated file', () => {
      expect(sut.content).toContain(
        "import { OrderState, Ping, Pong } from '../src/literal-names.js'"
      )
    })
  })

  describe('when no files match the entry globs', () => {
    it('should throw MessageTypeGenerationFailed', () => {
      expect(() =>
        generateMessageTypes({ cwd: SUPPORTED, entry: ['nothing/**/*.ts'] })
      ).toThrow(MessageTypeGenerationFailed)
    })
  })

  describe('when the tsconfig is missing', () => {
    it('should throw MessageTypeGenerationFailed', () => {
      expect(() =>
        generateMessageTypes({ cwd: SUPPORTED, project: 'missing.json' })
      ).toThrow(MessageTypeGenerationFailed)
    })
  })

  describe('when generating for unsupported types', () => {
    let error: MessageTypeGenerationFailed

    beforeAll(() => {
      error = generationError(UNSUPPORTED)
    })

    it('should throw MessageTypeGenerationFailed', () => {
      expect(error).toBeInstanceOf(MessageTypeGenerationFailed)
    })

    it.each([
      ['a function', "HasFunction.callback: functions can't be sent as JSON"],
      [
        'a union of types restored differently',
        'HasAmbiguousUnion.when: string | Date mixes types'
      ],
      ['a generic class', 'HasGenericClass.box: Box<Date> is a generic class'],
      [
        'a class that is not exported',
        "HasUnexportedClass.hidden: Hidden isn't a named export of src/unsupported.ts"
      ],
      [
        'a type that cannot be resolved',
        "HasUnresolvedType.missing: its type can't be resolved"
      ],
      [
        'a $name that cannot be worked out',
        "HasDynamicName (src/unsupported.ts): its $name can't be worked out"
      ],
      [
        'a $name used twice',
        'DuplicateB (src/unsupported.ts): its $name "bad/duplicate" is also used by DuplicateA'
      ],
      [
        'a tuple that needs restoring',
        "HasTuple.pair: tuples with values that need restoring aren't supported"
      ],
      ['a symbol', "HasSymbol.key: symbols can't be sent as JSON"],
      [
        'a Map with keys that are not strings or numbers',
        'HasDateKeys.byDate: Map keys must be strings or numbers'
      ],
      [
        'an object type with methods',
        'HasMethodInterface.shape: Shape has a method (area)'
      ],
      ['another built-in type', "HasRegExp.pattern: RegExp isn't supported"]
    ])('should report %s', (_, problem) => {
      expect(error.problems).toContainEqual(expect.stringContaining(problem))
    })

    it('should report nothing else', () => {
      expect(error.problems).toHaveLength(12)
    })
  })
})
