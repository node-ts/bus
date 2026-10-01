import { Type } from 'class-transformer'

export class TestOrderLine {
  sku: string
  quantity: number
  unitPrice: number

  @Type(() => Date)
  addedAt: Date

  total(): number {
    return this.quantity * this.unitPrice
  }
}
