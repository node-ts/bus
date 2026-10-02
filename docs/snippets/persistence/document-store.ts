// Stands in for the client of the database a persistence adapts. It isn't
// shown on the site.

export interface StoredWorkflowState {
  id: string
  version: number
  data: object
}

export interface DocumentStore {
  connect(): Promise<void>
  close(): Promise<void>
  createCollection(name: string, indexedFields: string[]): Promise<void>
  find(
    collection: string,
    filter: Record<string, unknown>
  ): Promise<StoredWorkflowState[]>
  insert(collection: string, document: StoredWorkflowState): Promise<void>
  /**
   * Replaces a document only if it still has the expected version
   * @returns whether the document was replaced
   */
  replaceIfVersion(
    collection: string,
    expectedVersion: number,
    document: StoredWorkflowState
  ): Promise<boolean>
}

export declare const documentStore: DocumentStore
