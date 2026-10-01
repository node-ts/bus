import { Address } from './address.js'
import { Message } from './base.js'
import { Address as OtherAddress } from './other/address.js'
import { TreeNode } from './tree-node.js'

export enum Status {
  Open = 'open',
  Closed = 'closed'
}

export interface Audit {
  at: Date
  by: string
}

type Id = string & { __brand: 'Id' }

export class Line {
  sku: string
  addedAt: Date
}

export class PlaceOrder extends Message {
  static NAME = 'fixture/place-order'
  $name = PlaceOrder.NAME
  $version = 1

  id: Id
  status: Status
  kind: 'a' | 'b'
  flag: boolean
  anything: unknown
  placedAt: Date
  shipTo: Address
  billTo?: OtherAddress
  lines: Line[]
  reminders: Date[]
  nested: Date[][]
  byId: Map<string, Line>
  counts: Map<number, number>
  labels: Map<string, string>
  tags: Set<string>
  dates: ReadonlySet<Date>
  total: bigint
  audit: Audit
  history: Audit[]
  meta: { seenAt: Date; note: string }
  untouched: { note: string }
  lookup: Record<string, Date>
  cancelledAt: Date | null
  tree: TreeNode

  get lineCount(): number {
    return this.lines.length
  }
}
