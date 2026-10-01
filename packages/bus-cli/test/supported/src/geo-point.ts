export class GeoPoint {
  latitude: number
  surveyedAt: Date
  #secret = 1

  get label(): string {
    return `${this.latitude}`
  }

  isNorthern(): boolean {
    return this.latitude > 0 && this.#secret > 0
  }
}
