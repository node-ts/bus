import { randomUUID } from 'node:crypto'

export class TestSystemMessage {
  static NAME = `integration-${randomUUID()}`
  readonly $name = TestSystemMessage.NAME
  readonly $version: number = 0
}
