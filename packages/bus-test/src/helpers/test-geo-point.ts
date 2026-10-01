/**
 * The deepest class in `TestRoundTripCommand`: command → customer → address → geo point
 */
export class TestGeoPoint {
  latitude: number
  longitude: number

  surveyedAt: Date

  get coordinates(): string {
    return `${this.latitude},${this.longitude}`
  }

  isNorthern(): boolean {
    return this.latitude > 0
  }
}
