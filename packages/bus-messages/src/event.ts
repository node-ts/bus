import { Message } from './message'

export abstract class Event extends Message {
  abstract readonly $name: string
  abstract readonly $version: number
}
