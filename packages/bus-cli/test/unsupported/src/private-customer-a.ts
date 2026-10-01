class Customer {
  joinedAt: Date
}

export class UsesPrivateCustomerA {
  $name = 'bad/private-customer-a'
  customer: Customer
}
