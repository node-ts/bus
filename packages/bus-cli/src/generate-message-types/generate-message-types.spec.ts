import { join } from 'node:path'
import { MessageTypeGenerationFailed } from './error'
import {
  GeneratedMessageTypes,
  generateMessageTypes
} from './generate-message-types'

const TEST_DIRECTORY = join(__dirname, '..', '..', 'test')
const fixture = (name: string) => join(TEST_DIRECTORY, name)

const SUPPORTED = 'fixture-supported/src'
const SAME_NAMES = 'fixture-same-names/src'

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
      sut = generateMessageTypes({ cwd: fixture('supported') })
    })

    it('should write to the default file', () => {
      expect(sut.outFile).toEqual(
        join(fixture('supported'), 'src', 'message-types.generated.ts')
      )
    })

    it('should map every message and workflow state to a key for its declaration', () => {
      expect(sut.messageCount).toEqual(12)
      expect(sut.content).toContain(`  messages: {
    'fixture/cancel-order': '${SUPPORTED}/interface-messages#CancelOrder',
    'fixture/default-event': '${SUPPORTED}/default-definition#default',
    'fixture/file-deleted': '${SUPPORTED}/interface-messages#FileDeleted',
    'fixture/file-uploaded': '${SUPPORTED}/interface-messages#FileUploaded',
    'fixture/order-shipped': '${SUPPORTED}/defined-messages#OrderShipped',
    'fixture/order-state': '${SUPPORTED}/literal-names#OrderState',
    'fixture/ping': '${SUPPORTED}/literal-names#Ping',
    'fixture/place-order': '${SUPPORTED}/place-order#PlaceOrder',
    'fixture/place-urgent-order': '${SUPPORTED}/place-urgent-order#PlaceUrgentOrder',
    'fixture/pong': '${SUPPORTED}/literal-names#Pong',
    'fixture/ship-order': '${SUPPORTED}/defined-messages#ShipOrder',
    'fixture/tag-message': '${SUPPORTED}/tag#TagMessage'
  },`)
    })

    it('should describe a message declared with defineCommand as an object type', () => {
      expect(sut.content)
        .toContain(`    '${SUPPORTED}/defined-messages#ShipOrder': {
      fields: {
        shipAt: 'Date',
        to: { type: '${SUPPORTED}/address#Address' },
        parcels: { array: { type: '${SUPPORTED}/defined-messages#ShipOrder.parcels[]' } }
      }
    },`)
    })

    it('should read a definition that is a default export', () => {
      expect(sut.content)
        .toContain(`    '${SUPPORTED}/default-definition#default': {
      fields: {
        happenedAt: 'Date'
      }
    },`)
    })

    it('should give a defined message with no fields to restore an entry', () => {
      expect(sut.content)
        .toContain(`    '${SUPPORTED}/defined-messages#OrderShipped': {
      fields: {}
    },`)
    })

    it('should describe messages declared as an interface or type alias with a literal $name', () => {
      expect(sut.content)
        .toContain(`    '${SUPPORTED}/interface-messages#FileUploaded': {
      fields: {
        uploadedAt: 'Date'
      }
    },`)
      expect(sut.content)
        .toContain(`    '${SUPPORTED}/interface-messages#FileDeleted': {
      fields: {
        deletedAt: 'Date'
      }
    },`)
    })

    it('should read an interface and the definition declared from it once', () => {
      expect(sut.content)
        .toContain(`    '${SUPPORTED}/interface-messages#CancelOrder': {
      fields: {
        cancelledAt: 'Date'
      }
    },`)
      expect(sut.content).not.toContain('CancelOrder_2')
    })

    it('should warn about the abstract and unexported classes it skips', () => {
      expect(sut.warnings).toEqual([
        "AbstractMessage (src/base.ts): it's abstract, so it isn't read as a message. Make it concrete, or leave its $name to the classes that extend it",
        "Internal (src/literal-names.ts): it has a $name but isn't exported, so it isn't read as a message. Export it by name"
      ])
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
      expect(sut.content).toContain(`    '${SUPPORTED}/other/address#Address': {
      class: Address_2,`)
    })

    it('should describe every field that needs restoring', () => {
      expect(sut.content)
        .toContain(`    '${SUPPORTED}/place-order#PlaceOrder': {
      class: PlaceOrder,
      fields: {
        placedAt: 'Date',
        shipTo: { type: '${SUPPORTED}/address#Address' },
        billTo: { type: '${SUPPORTED}/other/address#Address' },
        lines: { array: { type: '${SUPPORTED}/place-order#Line' } },
        reminders: { array: 'Date' },
        nested: { array: { array: 'Date' } },
        byId: { map: { type: '${SUPPORTED}/place-order#Line' } },
        counts: { map: 'plain', keys: 'number' },
        labels: { map: 'plain' },
        tags: { set: 'plain' },
        dates: { set: 'Date' },
        total: 'BigInt',
        audit: { type: '${SUPPORTED}/place-order#Audit' },
        history: { array: { type: '${SUPPORTED}/place-order#Audit' } },
        meta: { type: '${SUPPORTED}/place-order#PlaceOrder.meta' },
        lookup: { record: 'Date' },
        cancelledAt: 'Date',
        tree: { type: '${SUPPORTED}/tree-node#TreeNode' }
      }
    },`)
    })

    it('should describe object types without a class', () => {
      expect(sut.content).toContain(`    '${SUPPORTED}/place-order#Audit': {
      fields: {
        at: 'Date'
      }
    },`)
      expect(sut.content)
        .toContain(`    '${SUPPORTED}/place-order#PlaceOrder.meta': {
      fields: {
        seenAt: 'Date'
      }
    },`)
    })

    it('should describe recursive classes', () => {
      expect(sut.content).toContain(`    '${SUPPORTED}/tree-node#TreeNode': {
      class: TreeNode,
      fields: {
        createdAt: 'Date',
        children: { array: { type: '${SUPPORTED}/tree-node#TreeNode' } },
        parent: { type: '${SUPPORTED}/tree-node#TreeNode' }
      }
    }`)
    })

    it('should skip getters, methods, static fields and #private fields', () => {
      expect(sut.content).toContain(`    '${SUPPORTED}/geo-point#GeoPoint': {
      class: GeoPoint,
      fields: {
        surveyedAt: 'Date'
      }
    },`)
      expect(sut.content).not.toContain('defaultTaggedAt')
    })

    it('should include the inherited fields of a message that extends another message', () => {
      expect(sut.content)
        .toContain(`    '${SUPPORTED}/place-urgent-order#PlaceUrgentOrder': {
      class: PlaceUrgentOrder,
      fields: {
        urgentAt: 'Date',
        placedAt: 'Date',`)
    })

    it('should treat a $name that is only declared as data, not as a message', () => {
      expect(sut.content).toContain(`    '${SUPPORTED}/tag#Tag': {
      class: Tag,
      fields: {
        taggedAt: 'Date'
      }
    },`)
      expect(sut.content).not.toContain("'fixture/tag'")
    })
  })

  describe('when one library declares the same name in several modules', () => {
    let sut: GeneratedMessageTypes

    beforeAll(() => {
      sut = generateMessageTypes({ cwd: fixture('same-names') })
    })

    it('should key two exported classes with the same name by their module', () => {
      expect(sut.content)
        .toContain(`    '${SAME_NAMES}/billing/customer#Customer': {
      class: Customer,
      fields: {
        billedAt: 'Date'
      }
    },`)
      expect(sut.content)
        .toContain(`    '${SAME_NAMES}/shipping/customer#Customer': {
      class: Customer_2,
      fields: {
        shippedAt: 'Date',
        address: { type: '${SAME_NAMES}/shipping/customer#Customer.address' }
      }
    },`)
    })

    it('should key an interface and a type alias with the same name by their module', () => {
      expect(sut.content)
        .toContain(`    '${SAME_NAMES}/billing/contact#Contact': {
      fields: {
        calledAt: 'Date'
      }
    },`)
      expect(sut.content)
        .toContain(`    '${SAME_NAMES}/shipping/contact#Contact': {
      fields: {
        visitedAt: 'Date'
      }
    },`)
    })

    it('should key a class and an interface with the same name by their module', () => {
      expect(sut.content)
        .toContain(`    '${SAME_NAMES}/billing/account#Account': {
      class: Account,`)
      expect(sut.content)
        .toContain(`    '${SAME_NAMES}/shipping/account#Account': {
      fields: {
        closedAt: 'Date'
      }
    },`)
    })

    it('should give a class re-exported under an alias the key of its declaration', () => {
      expect(sut.content)
        .toContain(`        customer: { type: '${SAME_NAMES}/billing/customer#Customer' },
        payer: { type: '${SAME_NAMES}/billing/customer#Customer' },`)
      expect(sut.content).not.toContain('BillingCustomer')
    })
  })

  describe('when two libraries declare the same name in the same module path', () => {
    let a: GeneratedMessageTypes
    let b: GeneratedMessageTypes

    beforeAll(() => {
      a = generateMessageTypes({ cwd: fixture('two-libraries/a') })
      b = generateMessageTypes({ cwd: fixture('two-libraries/b') })
    })

    it('should prefix the keys with the package name', () => {
      expect(a.content).toContain(
        "'fixture-library-a/src/customer#Customer': {"
      )
      expect(b.content).toContain(
        "'fixture-library-b/src/customer#Customer': {"
      )
    })
  })

  describe('when the project imports the generated file before it exists', () => {
    let sut: GeneratedMessageTypes

    beforeAll(() => {
      sut = generateMessageTypes({ cwd: fixture('imports-generated') })
    })

    it('should generate it', () => {
      expect(sut.messageCount).toEqual(1)
      expect(sut.warnings).toEqual([])
    })
  })

  describe('when the project is not strict and has a type error', () => {
    let sut: GeneratedMessageTypes

    beforeAll(() => {
      sut = generateMessageTypes({ cwd: fixture('non-strict') })
    })

    it('should generate the types', () => {
      expect(sut.content).toContain("        placedAt: 'Date',")
    })

    it('should report the type error as a warning', () => {
      expect(sut.warnings).toContain(
        "src/order.ts:13:11: Type 'string' is not assignable to type 'number'."
      )
    })

    it('should warn that nothing imports the generated file', () => {
      expect(sut.warnings).toContainEqual(
        expect.stringContaining(
          "Nothing in the project imports src/message-types.generated.ts, so its types won't be registered"
        )
      )
    })
  })

  describe('when the project resolves modules like a bundler', () => {
    let sut: GeneratedMessageTypes

    beforeAll(() => {
      sut = generateMessageTypes({
        cwd: fixture('supported'),
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
        cwd: fixture('supported'),
        entry: ['src/**/*.ts'],
        exclude: [
          'src/index.ts',
          'src/place-order.ts',
          'src/place-urgent-order.ts'
        ],
        out: 'generated/types.ts'
      })
    })

    it('should only include messages declared in those files', () => {
      expect(sut.messageCount).toEqual(10)
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
        generateMessageTypes({
          cwd: fixture('supported'),
          entry: ['nothing/**/*.ts']
        })
      ).toThrow(MessageTypeGenerationFailed)
    })
  })

  describe('when the tsconfig is missing', () => {
    it('should throw MessageTypeGenerationFailed', () => {
      expect(() =>
        generateMessageTypes({
          cwd: fixture('supported'),
          project: 'missing.json'
        })
      ).toThrow(MessageTypeGenerationFailed)
    })
  })

  describe('when declarations with a $name are skipped', () => {
    let sut: GeneratedMessageTypes

    beforeAll(() => {
      sut = generateMessageTypes({
        cwd: fixture('skipped'),
        entry: ['src/*.ts']
      })
    })

    it('should only read the messages', () => {
      expect(sut.messageCount).toEqual(2)
    })

    it.each([
      [
        'an unexported class',
        "NotExported (src/skipped.ts): it has a $name but isn't exported"
      ],
      [
        'an unexported definition',
        "NotExportedDefinition (src/skipped.ts): it has a $name but isn't exported"
      ],
      [
        'an abstract class',
        "AbstractWithName (src/skipped.ts): it's abstract, so it isn't read as a message"
      ],
      [
        'a class whose $name is never set',
        'UnsetName (src/skipped.ts): its $name is declared but never set'
      ],
      [
        'an interface whose $name is not a literal',
        'StringName (src/skipped.ts): its $name is string, not a string literal'
      ],
      [
        'a generic interface',
        "Envelope (src/skipped.ts): it's generic, so it isn't read as a message"
      ],
      [
        'an interface with the $name of a class',
        'SameNameAsClass (src/skipped.ts): its $name "skipped/class-message" is also used by ClassMessage (src/skipped.ts), which is read instead'
      ],
      [
        'a definition inside an exported object',
        "Grouped.GroupedCommand (src/skipped.ts): it's a definition inside an object, so it isn't read as a message"
      ],
      [
        'a class that inherits its static NAME',
        'InheritsName (src/skipped.ts): it inherits its static NAME, so the bus rejects it as a message with MessageNameInherited'
      ],
      [
        'a message re-exported from a file that is not an entry',
        "Elsewhere (src/not-entry/elsewhere.ts): it's exported from src/index.ts, but the file that declares it isn't an entry file, so it isn't read as a message. Add src/not-entry/elsewhere.ts to the entry files"
      ]
    ])('should warn about %s', (_, warning) => {
      expect(sut.warnings).toContainEqual(expect.stringContaining(warning))
    })

    it('should warn about nothing else', () => {
      expect(sut.warnings).toHaveLength(11)
    })
  })

  describe('when generating for unsupported types', () => {
    let error: MessageTypeGenerationFailed

    beforeAll(() => {
      error = generationError(fixture('unsupported'))
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
      ['a generic message', 'GenericMessage: GenericMessage is generic'],
      [
        'a class that is not exported',
        "HasUnexportedClass.hidden: Hidden isn't a named export of src/unsupported.ts"
      ],
      [
        'the first of two private classes with the same name',
        "UsesPrivateCustomerA.customer: Customer isn't a named export of src/private-customer-a.ts"
      ],
      [
        'the second of two private classes with the same name',
        "UsesPrivateCustomerB.customer: Customer isn't a named export of src/private-customer-b.ts"
      ],
      ['an abstract class', 'HasAbstractField.payment: Payment is abstract'],
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
      ['another built-in type', "HasRegExp.pattern: RegExp isn't supported"],
      [
        'an interface $name used twice',
        'DuplicateInterfaceB (src/unsupported.ts): its $name "bad/duplicate-interface" is also used by DuplicateInterfaceA'
      ],
      [
        'a definition whose $name cannot be worked out',
        "DynamicDefinition (src/unsupported.ts): its $name can't be worked out without running the code. Pass a string literal to defineCommand or defineEvent"
      ],
      [
        'a subclass whose inherited static NAME is not its $name',
        'ChildWithOwnName (src/unsupported.ts): its static NAME "bad/parent-name", which it inherits, isn\'t its $name "bad/child-name"'
      ],
      [
        'a static NAME that is not the $name',
        'MismatchedName (src/unsupported.ts): its static NAME "bad/static-name" isn\'t its $name "bad/instance-name"'
      ],
      [
        'a definition with a field that cannot be restored',
        "DefinitionWithFunction.callback: functions can't be sent as JSON"
      ]
    ])('should report %s', (_, problem) => {
      expect(error.problems).toContainEqual(expect.stringContaining(problem))
    })

    it('should report nothing else', () => {
      expect(error.problems).toHaveLength(21)
    })
  })
})
