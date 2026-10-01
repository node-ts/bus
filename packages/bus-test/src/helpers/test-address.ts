import { TestGeoPoint } from './test-geo-point'

export class TestAddress {
  street: string
  city: string

  location: TestGeoPoint

  get label(): string {
    return `${this.street}, ${this.city}`
  }
}
