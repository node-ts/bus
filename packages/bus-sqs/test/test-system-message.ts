import * as faker from 'faker'

export const testSystemMessageName = faker.random.uuid()

export class TestSystemMessage {
  constructor (
    readonly name = testSystemMessageName
  ) {
  }
}
