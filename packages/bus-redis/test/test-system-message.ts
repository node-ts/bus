import * as faker from 'faker'

export class TestSystemMessage {
  static readonly NAME = `integration-${faker.random.uuid()}`
  constructor (
    readonly name = TestSystemMessage.NAME
  ) {
  }
}
