import * as faker from 'faker'

export class TestSystemMessage {
  static readonly NAME = faker.random.uuid()
  constructor (
    readonly name = TestSystemMessage.NAME
  ) {
  }
}
