import { Event } from '@node-ts/bus-messages'

export class TaskRan extends Event {
  static NAME = '@node-ts/bus-core/task-ran'
  $name = TaskRan.NAME
  $version = 0
  listIdCompleted: number

  constructor(readonly value: string, listIdCompleted?: number) {
    super()
    listIdCompleted = this.listIdCompleted
  }
}
