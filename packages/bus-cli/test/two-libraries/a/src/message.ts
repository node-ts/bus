import { Customer } from './customer.js'

export class MessageA {
  static NAME = 'fixture/message-a'
  $name = MessageA.NAME
  customer: Customer
}
