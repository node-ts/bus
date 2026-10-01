import { defineCommand, MessageData } from '@node-ts/bus-messages'

/**
 * A message declared as an interface with a literal $name
 */
export interface FileUploaded {
  $name: 'fixture/file-uploaded'
  $version: 0
  uploadedAt: Date
}

/**
 * A message declared as a type alias with a literal $name
 */
export type FileDeleted = {
  $name: 'fixture/file-deleted'
  $version: 0
  deletedAt: Date
}

/**
 * An interface that a definition is declared from, which is read once
 */
export interface CancelOrder {
  $name: 'fixture/cancel-order'
  $version: 0
  cancelledAt: Date
}
export const CancelOrder = defineCommand('fixture/cancel-order')<
  MessageData<CancelOrder>
>()

/**
 * A union of messages isn't a message
 */
export type FileMessage = FileUploaded | FileDeleted
