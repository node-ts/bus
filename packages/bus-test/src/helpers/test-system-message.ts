import { Message } from '@node-ts/bus-messages'
import * as faker from 'faker'

export class TestSystemMessage extends Message {
  static NAME = `integration-${faker.random.uuid()}`
  readonly $name = TestSystemMessage.NAME
  readonly $version: number = 0
}
