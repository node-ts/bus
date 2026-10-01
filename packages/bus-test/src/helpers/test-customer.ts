import { TestAddress } from './test-address'

export class TestCustomer {
  name: string

  address: TestAddress

  previousAddresses: TestAddress[]

  joinedAt: Date
}
