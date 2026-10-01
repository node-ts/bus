import { Type } from 'class-transformer'
import { TestAddress } from './test-address'

export class TestCustomer {
  name: string

  @Type(() => TestAddress)
  address: TestAddress

  @Type(() => TestAddress)
  previousAddresses: TestAddress[]

  @Type(() => Date)
  joinedAt: Date
}
