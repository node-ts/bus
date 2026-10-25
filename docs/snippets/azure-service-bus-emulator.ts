import {
  ServiceBusAdministrationClient,
  ServiceBusClient
} from '@azure/service-bus'
import { AzureServiceBusTransport } from '@node-ts/bus-azure-service-bus'

// The emulator's fixed development connection string. Its management API is on another port.
const emulator = (port: number) =>
  `Endpoint=sb://localhost:${port};SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;`

export const transport = new AzureServiceBusTransport(
  { queueName: 'reservations-service' },
  new ServiceBusClient(emulator(5672)),
  new ServiceBusAdministrationClient(emulator(5300))
)
