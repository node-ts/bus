export abstract class Payment {
  paidAt: Date
}

export class Card extends Payment {
  last4: string
}

export class HasAbstractField {
  $name = 'bad/abstract'
  payment: Payment
}

export class GenericMessage<T> {
  $name = 'bad/generic-message'
  payload: T
}
