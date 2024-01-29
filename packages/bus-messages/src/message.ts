/**
 * A base message type that is transmitted over a transport. Declaring messages with this base class enables
 * efficient routing and dispatch to handlers.
 */
export abstract class Message {
  abstract readonly $name: string
  abstract readonly $version: number
}
