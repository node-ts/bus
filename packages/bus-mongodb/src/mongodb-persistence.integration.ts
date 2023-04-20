import {
  Bus,
  WorkflowStatus,
  MessageWorkflowMapping,
  Logger,
  BusInstance,
} from "@node-ts/bus-core";
import { MessageAttributes } from "@node-ts/bus-messages";
import { MongodbPersistence } from "./mongodb-persistence";
import { MongodbConfiguration } from "./mongodb-configuration";
import { Mock } from "typemoq";
import { TestWorkflowState, TestCommand, TestWorkflow } from "../test";
import { Pool } from "pg";
import * as uuid from "uuid";
import { Collection, Db, MongoClient } from "mongodb";
import { WorkflowStateNotFound } from "./error";

const configuration: MongodbConfiguration = {
  connection: "mongodb://localhost:27017/workflows",
  databaseName: "workflows",
};

describe("MongodbPersistence", () => {
  let sut: MongodbPersistence;
  let client: MongoClient;
  let database: Db;
  let collection: Collection;
  let bus: BusInstance;

  beforeAll(async () => {
    client = new MongoClient(configuration.connection);
    client = await client.connect();
    database = client.db(configuration.databaseName) as Db;
    collection = database.collection("testworkflowstate") as Collection;
    sut = new MongodbPersistence(configuration);
    bus = await Bus.configure()
      .withLogger(() => Mock.ofType<Logger>().object)
      .withPersistence(sut)
      .withWorkflow(TestWorkflow)
      .initialize();

    await bus.start();
  });

  afterAll(async () => {
    await client.db(configuration.databaseName).dropDatabase();
    await bus.dispose();
  });

  describe("when initializing the persistence", () => {
    it("should create a workflow table", async () => {
      const count = await collection.countDocuments();
      expect(count).toEqual(0);
    });
  });

  describe("when saving new workflow state", () => {
    const workflowState = new TestWorkflowState();
    workflowState.$workflowId = uuid.v4();
    workflowState.$status = WorkflowStatus.Running;
    workflowState.$version = 0;
    workflowState.eventValue = "abc";
    workflowState.property1 = "something";

    beforeAll(async () => {
      await sut.saveWorkflowState(workflowState);
    });

    it("should add the row into the table", async () => {
      const result = await collection.find().toArray();
      expect(result.length).toEqual(1);
      expect(result[0]).toMatchObject({
        id: workflowState.$workflowId,
        version: 1,
        data: {
          __workflowId: workflowState.$workflowId,
          __status: WorkflowStatus.Running,
          __version: 1,
          __name: "TestWorkflowState",
          eventValue: "abc",
          property1: "something",
        },
      });
    });

    describe("when getting the workflow state by property", () => {
      const testCommand = new TestCommand(workflowState.property1);
      const messageOptions: MessageAttributes = {
        attributes: {},
        stickyAttributes: {},
      };
      let dataV1: TestWorkflowState;
      let mapping: MessageWorkflowMapping<TestCommand, TestWorkflowState>;

      it("should retrieve the item", async () => {
        mapping = {
          lookup: (message) => message.property1,
          mapsTo: "property1",
        };
        const results = await sut.getWorkflowState(
          TestWorkflowState,
          mapping,
          testCommand,
          messageOptions
        );
        expect(results).toHaveLength(1);
        dataV1 = results[0];
        expect(dataV1).toMatchObject({ ...workflowState, $version: 1 });
      });

      describe("when updating the workflow state", () => {
        let updates: TestWorkflowState;
        let dataV2: TestWorkflowState;

        beforeAll(async () => {
          updates = {
            ...dataV1,
            eventValue: "something else",
          };
          await sut.saveWorkflowState(updates);

          const results = await sut.getWorkflowState(
            TestWorkflowState,
            mapping,
            testCommand,
            messageOptions
          );
          dataV2 = results[0];
        });

        it("should return the updates", () => {
          expect(dataV2).toMatchObject({
            ...updates,
            $version: 2,
          });
        });
      });
      describe("when updating the workflow state with invalid version", () => {
        let updates: TestWorkflowState;
        let error: Error;

        beforeAll(async () => {
          updates = {
            ...dataV1,
            eventValue: "something else",
          };
          try {
            await sut.saveWorkflowState(updates);
          } catch (err) {
            error = err;
          }
        });

        it("should throw WorkflowStateNotFound", async () => {
          expect(error).toBeInstanceOf(WorkflowStateNotFound);
        });
      });
    });
  });
});
