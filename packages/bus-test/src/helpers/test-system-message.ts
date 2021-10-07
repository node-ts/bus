import * as uuid from 'uuid'

export class TestSystemMessage {
  static NAME = `integration-${uuid.v4()}`
  readonly $name = TestSystemMessage.NAME
  readonly $version: number = 0
}
