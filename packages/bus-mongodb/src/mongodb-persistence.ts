import {
  ClassConstructor,
  CoreDependencies,
  Logger,
  MessageWorkflowMapping,
  Persistence,
  WorkflowState,
} from "@node-ts/bus-core";
import { Message, MessageAttributes } from "@node-ts/bus-messages";
import { Db, MongoClient } from "mongodb";
import { MongodbConfiguration } from "./mongodb-configuration";
import { WorkflowStateNotFound } from "./error";
import { mapKeys } from "lodash";
/**
 * The name of the field that stores workflow state as JSON in the database row.
 */
const WORKFLOW_DATA_FIELD_NAME = "data";

export class MongodbPersistence implements Persistence {
  private coreDependencies: CoreDependencies;
  private logger: Logger;
  private database: Db;
  constructor(
    private readonly configuration: MongodbConfiguration,
    private client: MongoClient = new MongoClient(configuration.connection)
  ) {}

  prepare(coreDependencies: CoreDependencies): void {
    this.coreDependencies = coreDependencies;
    this.logger = coreDependencies.loggerFactory(
      "@node-ts/bus-persistence:mongodb-persistence"
    );
  }

  async initialize(): Promise<void> {
    this.logger.info("Initializing mongodb persistence...");
    await this.client.connect();
    this.database = this.client.db(this.configuration.databaseName);
    this.logger.info("Mongodb persistence initialized");
  }

  async dispose(): Promise<void> {
    this.logger.info("Disposing Mongodb persistence...");
    await this.client.close();
    this.logger.info("Mongodb persistence disposed");
  }

  async initializeWorkflow<WorkflowStateType extends WorkflowState>(
    workflowStateConstructor: ClassConstructor<WorkflowStateType>,
    messageWorkflowMappings: MessageWorkflowMapping<Message, WorkflowState>[]
  ): Promise<void> {
    await this.client.connect();
    this.database = this.client.db(this.configuration.databaseName);
    const workflowStateName = new workflowStateConstructor().$name;
    this.logger.info("Initializing workflow", {
      workflowState: workflowStateName,
    });

    const collectionName = resolveQualifiedTableName(workflowStateName);
    await this.ensureCollectionExists(collectionName);
    await this.ensureIndexesExist(collectionName, messageWorkflowMappings);
  }

  async getWorkflowState<
    WorkflowStateType extends WorkflowState,
    MessageType extends Message
  >(
    workflowStateConstructor: ClassConstructor<WorkflowStateType>,
    messageMap: MessageWorkflowMapping<MessageType, WorkflowStateType>,
    message: MessageType,
    attributes: MessageAttributes,
    includeCompleted = false
  ): Promise<WorkflowStateType[]> {
    this.logger.debug("Getting workflow state", {
      workflowStateName: workflowStateConstructor.name,
    });
    const workflowStateName = new workflowStateConstructor().$name;
    const tableName = resolveQualifiedTableName(workflowStateName);
    const matcherValue = messageMap.lookup(message, attributes);
    const workflowStateField = `${WORKFLOW_DATA_FIELD_NAME}.${normalizeProperty(
      messageMap.mapsTo
    )}`;
    const collection = this.database.collection(tableName);
    const findObject = {
      [workflowStateField]: matcherValue,
    } as any;
    if (!includeCompleted) {
      findObject[
        `${WORKFLOW_DATA_FIELD_NAME}.${normalizeProperty("$status")}`
      ] = "running";
    }
    const documents = await collection.find(findObject).toArray();
    this.logger.debug("Querying workflow state", { findObject });

    this.logger.debug("Got workflow state", {
      resultsCount: documents?.length,
    });

    const rows = documents?.map((x) => x[WORKFLOW_DATA_FIELD_NAME]) as any[];
    return rows
      .map((row) => mapKeys(row, (value, key) => denormalizeProperty(key)))
      .filter((workflowState) => workflowState !== undefined)
      .map((workflowState) =>
        this.coreDependencies.serializer.toClass(
          workflowState!,
          workflowStateConstructor
        )
      );
  }

  async saveWorkflowState<WorkflowStateType extends WorkflowState>(
    workflowState: WorkflowStateType
  ): Promise<void> {
    this.logger.debug("Saving workflow state", {
      workflowStateName: workflowState.$name,
      id: workflowState.$workflowId,
    });
    const collectionName = resolveQualifiedTableName(workflowState.$name);

    const oldVersion = workflowState.$version;
    const newVersion = oldVersion + 1;
    const modifiedState = mapKeys(workflowState, (value, key) => {
      return normalizeProperty(key);
    });
    const plainWorkflowState = {
      ...this.coreDependencies.serializer.toPlain(modifiedState),
      __version: newVersion,
    };

    await this.upsertWorkflowState(
      collectionName,
      workflowState.$workflowId,
      plainWorkflowState,
      oldVersion,
      newVersion
    );
  }

  private async ensureCollectionExists(collectionName: string): Promise<void> {
    this.logger.debug("Ensuring mongodb collection for workflow state exists", {
      collectionName,
    });
    const collectionExists = await this.database
      .listCollections({ name: collectionName }, { nameOnly: true })
      .hasNext();
    if (!collectionExists) {
      await this.database.createCollection(collectionName);
    }
  }

  private async ensureIndexesExist(
    collectionName: string,
    messageWorkflowMappings: MessageWorkflowMapping<Message, WorkflowState>[]
  ): Promise<void> {
    const collection = this.database.collection(collectionName);
    const existingIndexes = (await collection.listIndexes().toArray()) ?? [];
    const existingIndexNames = existingIndexes
      .map((index) => index.name)
      .filter((x) => x !== "_id_");
    const createPrimaryIndex = this.createPrimaryIndex(
      collectionName,
      existingIndexNames as string[]
    );

    const allWorkflowFields = messageWorkflowMappings.map(
      (mapping) => mapping.mapsTo
    );
    const distinctWorkflowFields = new Set(allWorkflowFields);
    const workflowFields: string[] = [...distinctWorkflowFields];

    const createSecondaryIndexes = workflowFields.map(async (workflowField) => {
      const indexName = resolveIndexName(collectionName, workflowField);
      const existingIndexLocation = existingIndexNames.indexOf(indexName);
      if (existingIndexLocation !== -1) {
        this.logger.debug("Index already exists", { indexName });
        existingIndexNames.splice(existingIndexLocation, 1);
        return;
      }
      const workflowStateField = `${WORKFLOW_DATA_FIELD_NAME}.'${workflowField}'`;
      this.logger.debug("Ensuring secondary index exists", {
        indexName,
      });
      await collection.createIndex(
        { [workflowStateField]: 1 },
        { name: indexName }
      );
    });
    const dropIndexes = existingIndexNames.map(async (indexName) => {
      await collection.dropIndex(indexName);
    });
    await Promise.all([
      createPrimaryIndex,
      ...createSecondaryIndexes,
      ...dropIndexes,
    ]);
  }

  private async createPrimaryIndex(
    collectionName: string,
    existingIndexesNames: string[]
  ): Promise<void> {
    const collection = this.database.collection(collectionName);
    const primaryIndexName = resolveIndexName(collectionName, "id", "version");
    const primaryIndexLocation = existingIndexesNames.indexOf(primaryIndexName);
    if (primaryIndexLocation !== -1) {
      existingIndexesNames.splice(primaryIndexLocation, 1);
      return;
    }
    this.logger.debug("Ensuring primary index exists", {
      primaryIndexName,
    });
    await collection.createIndex(
      { _id: 1, version: 1 },
      { name: primaryIndexName }
    );
  }

  private async upsertWorkflowState(
    collectionName: string,
    workflowId: string,
    plainWorkflowState: object,
    oldVersion: number,
    newVersion: number
  ): Promise<void> {
    const collection = this.database.collection(collectionName);
    if (oldVersion === 0) {
      this.logger.debug("Inserting new workflow state", {
        collectionName,
        workflowId,
        oldVersion,
        newVersion,
      });
      // This is a new workflow, so just insert the data
      await collection.insertOne({
        id: workflowId,
        version: newVersion,
        [WORKFLOW_DATA_FIELD_NAME]: plainWorkflowState,
      });
    } else {
      this.logger.debug("Updating existing workflow state", {
        collectionName,
        workflowId,
        oldVersion,
        newVersion,
      });
      const result = await collection.findOneAndUpdate(
        {
          id: workflowId,
          version: oldVersion,
        },
        {
          $set: {
            version: newVersion,
            [WORKFLOW_DATA_FIELD_NAME]: plainWorkflowState,
          },
        }
      );
      if (!result?.value) {
        throw new WorkflowStateNotFound(workflowId, collectionName, oldVersion);
      }
    }
  }
}

/**
 * Returns a legal fully qualified schema + table name
 */
function resolveQualifiedTableName(collectionName: string): string {
  const invalidPostgresCharacters = /[^0-9a-zA-Z_.-]/g;
  const normalizedTableName = collectionName
    .replace(invalidPostgresCharacters, "")
    .toLowerCase();
  const formattedTableName = toSnakeCase(normalizedTableName);
  return `${formattedTableName}`;
}

/**
 * Converts pascal to snake case
 * @example MyTableName => my_table_name
 */
function toSnakeCase(value: string): string {
  return value.replace(/([A-Z])/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Resolves the name of an index from the fields contained in that index
 */
function resolveIndexName(tableName: string, ...fields: string[]): string {
  const normalizedTableName = tableName.replace(/"/g, "").replace(".", "_");
  return `"${normalizedTableName}_${fields.join("_")}_idx"`;
}
function normalizeProperty(property: string): string {
  return property.replace("$", "__");
}
function denormalizeProperty(property: string): string {
  return property.replace("__", "$");
}
