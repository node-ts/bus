import { Message } from './message'

export abstract class Command extends Message {
  abstract readonly $name: string
  abstract readonly $version: number
}
