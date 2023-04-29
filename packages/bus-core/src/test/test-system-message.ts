import * as faker from 'faker'
export class TestSystemMessage {
  static NAME = faker.random.uuid()
  constructor(readonly name = TestSystemMessage.NAME) {}
}
