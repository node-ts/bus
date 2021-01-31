import * as faker from 'faker'

export class TestSystemMessage {
  static NAME = `integration-${faker.random.uuid()}`

  constructor (
    readonly name = TestSystemMessage.NAME
  ) {
  }
}
