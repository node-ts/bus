import * as faker from 'faker'
import { Event } from '@node-ts/bus-messages'

export class TestSystemMessage {
  static NAME = `integration-${faker.random.uuid()}`
  readonly $name = TestSystemMessage.NAME
  readonly $version = 0
}
