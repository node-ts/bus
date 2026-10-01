import { BillingCustomer } from './aliases.js'
import { Account } from './billing/account.js'
import { Contact } from './billing/contact.js'
import { Customer } from './billing/customer.js'

export class Invoice {
  $name = 'fixture/invoice'
  customer: Customer
  payer: BillingCustomer
  contact: Contact
  account: Account
}
