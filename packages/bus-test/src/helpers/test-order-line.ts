export class TestOrderLine {
  sku: string
  quantity: number
  unitPrice: number

  addedAt: Date

  total(): number {
    return this.quantity * this.unitPrice
  }
}
