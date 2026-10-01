// Every class here has one field or $name that the generator rejects
// @ts-expect-error the module doesn't exist, so the type can't be resolved
import { Missing } from './does-not-exist'

export class HasFunction {
  $name = 'bad/function'
  callback: () => void
}

export class HasAmbiguousUnion {
  $name = 'bad/union'
  when: Date | string
}

export class Box<T> {
  value: T
}

export class HasGenericClass {
  $name = 'bad/generic'
  box: Box<Date>
}

class Hidden {
  at: Date
}

export class HasUnexportedClass {
  $name = 'bad/unexported'
  hidden: Hidden
}

export class HasUnresolvedType {
  $name = 'bad/unresolved'
  missing: Missing
}

export class HasDynamicName {
  $name = `bad/${Math.random()}`
}

export class DuplicateA {
  $name = 'bad/duplicate'
}

export class DuplicateB {
  $name = 'bad/duplicate'
}

export class HasTuple {
  $name = 'bad/tuple'
  pair: [Date, string]
}

export class HasSymbol {
  $name = 'bad/symbol'
  key: symbol
}

export class HasDateKeys {
  $name = 'bad/date-keys'
  byDate: Map<Date, string>
}

interface Shape {
  area(): number
}

export class HasMethodInterface {
  $name = 'bad/method'
  shape: Shape
}

export class HasRegExp {
  $name = 'bad/regexp'
  pattern: RegExp
}
