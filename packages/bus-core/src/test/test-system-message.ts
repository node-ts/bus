import { faker } from '@faker-js/faker'
export class TestSystemMessage {
  static NAME = faker.string.uuid()
  constructor(readonly name = TestSystemMessage.NAME) {}
}
