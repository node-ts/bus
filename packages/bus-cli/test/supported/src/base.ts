export abstract class Message {
  abstract readonly $name: string
  abstract readonly $version: number
}

/**
 * Abstract, so it's skipped even though it has a $name
 */
export abstract class AbstractMessage extends Message {
  $name = 'fixture/abstract'
  $version = 0
}
