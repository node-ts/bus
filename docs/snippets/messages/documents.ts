import { Command, Event } from '@node-ts/bus-messages'

/**
 * A file was uploaded to the document store
 */
export class DocumentUploaded extends Event {
  static NAME = 'my-app/documents/document-uploaded'
  $name = DocumentUploaded.NAME
  $version = 0

  constructor(readonly key: string) {
    super()
  }
}

/**
 * Read the contents of an uploaded document
 */
export class ReadDocument extends Command {
  static NAME = 'my-app/documents/read-document'
  $name = ReadDocument.NAME
  $version = 0

  constructor(readonly key: string) {
    super()
  }
}

/**
 * The contents of an uploaded document were read
 */
export class DocumentRead extends Event {
  static NAME = 'my-app/documents/document-read'
  $name = DocumentRead.NAME
  $version = 0

  constructor(readonly key: string) {
    super()
  }
}
