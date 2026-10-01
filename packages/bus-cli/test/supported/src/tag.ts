/**
 * A nested class whose $name and $version are data fields, not a message
 */
export class Tag {
  $name: string
  $version: number
  taggedAt: Date

  static readonly defaultTaggedAt: Date = new Date(0)
}

export class TagMessage {
  $name = 'fixture/tag-message'
  tag: Tag
}
