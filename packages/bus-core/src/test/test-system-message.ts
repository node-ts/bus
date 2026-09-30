import { randomUUID } from 'node:crypto'
export class TestSystemMessage {
  static NAME = randomUUID()
  constructor(readonly name = TestSystemMessage.NAME) {}
}
