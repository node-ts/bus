export class Line {
  at: Date
}

export class Order {
  $name = 'fixture/order'
  placedAt: Date
  lines: Line[]
  untyped

  total(): number {
    // A type error, which is only a warning
    const total: number = 'not a number'
    return total
  }
}
