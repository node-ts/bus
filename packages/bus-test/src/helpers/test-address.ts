import { Type } from 'class-transformer'
import { TestGeoPoint } from './test-geo-point'

export class TestAddress {
  street: string
  city: string

  @Type(() => TestGeoPoint)
  location: TestGeoPoint

  get label(): string {
    return `${this.street}, ${this.city}`
  }
}
