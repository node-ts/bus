// Every declaration here has a $name but isn't read as a message, and is warned about
import { defineCommand } from '@node-ts/bus-messages'

class NotExported {
  $name = 'skipped/not-exported'
}

const NotExportedDefinition = defineCommand('skipped/not-exported-definition')()

export const instances = [new NotExported(), NotExportedDefinition()]

export abstract class AbstractWithName {
  $name = 'skipped/abstract'
}

export class UnsetName {
  $name: string
}

export interface StringName {
  $name: string
  at: Date
}

export interface Envelope<T> {
  $name: 'skipped/envelope'
  body: T
}

export class ClassMessage {
  $name = 'skipped/class-message'
}

export interface SameNameAsClass {
  $name: 'skipped/class-message'
  at: Date
}

export const Grouped = {
  GroupedCommand: defineCommand('skipped/grouped')()
}

export abstract class ParentMessage {
  static NAME = 'skipped/parent'
  $name = ParentMessage.NAME
}

export class InheritsName extends ParentMessage {}
