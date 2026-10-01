import { Account } from './shipping/account.js'
import { Contact } from './shipping/contact.js'
import { Customer } from './shipping/customer.js'

export class Shipment {
  $name = 'fixture/shipment'
  customer: Customer
  contact: Contact
  account: Account
}
