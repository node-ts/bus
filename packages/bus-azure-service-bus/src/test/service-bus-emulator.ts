import {
  ServiceBusAdministrationClient,
  ServiceBusClient
} from '@azure/service-bus'

// Overridable so CI and contributors can point at an emulator elsewhere. The defaults match docker-compose.yml.
const EMULATOR_HOST = process.env.SERVICE_BUS_EMULATOR_HOST || 'localhost'
const EMULATOR_AMQP_PORT = process.env.SERVICE_BUS_EMULATOR_AMQP_PORT || '5673'
const EMULATOR_MANAGEMENT_PORT =
  process.env.SERVICE_BUS_EMULATOR_MANAGEMENT_PORT || '5300'

/**
 * The emulator's fixed development connection string, for the given port
 */
const emulatorConnectionString = (port: string) =>
  `Endpoint=sb://${EMULATOR_HOST}:${port};SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;`

/**
 * The connection string for sending and receiving over AMQP
 */
export const EMULATOR_CONNECTION_STRING =
  emulatorConnectionString(EMULATOR_AMQP_PORT)

/**
 * Creates a client for the emulator. The emulator allows 10 connections, and each client is one, so tests share a
 * client between transports.
 */
export const createEmulatorClient = () =>
  new ServiceBusClient(EMULATOR_CONNECTION_STRING)

/**
 * Creates an administration client for the emulator's management API, which is on its own port
 */
export const createEmulatorAdministrationClient = () =>
  new ServiceBusAdministrationClient(
    emulatorConnectionString(EMULATOR_MANAGEMENT_PORT)
  )

/**
 * Deletes every topic and queue in the emulator's namespace, which holds at most 50
 * @param administrationClient a client for the emulator's management API
 */
export const deleteAllEntities = async (
  administrationClient: ServiceBusAdministrationClient
): Promise<void> => {
  const topics: string[] = []
  for await (const topic of administrationClient.listTopics()) {
    topics.push(topic.name)
  }
  const queues: string[] = []
  for await (const queue of administrationClient.listQueues()) {
    queues.push(queue.name)
  }
  // Subscriptions forward to queues, so topics go first
  await Promise.all(
    topics.map(async name => administrationClient.deleteTopic(name))
  )
  await Promise.all(
    queues.map(async name => administrationClient.deleteQueue(name))
  )
}
