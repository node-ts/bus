import { sleep } from '@node-ts/bus-core'

const MANAGEMENT_URL =
  process.env.RABBITMQ_MANAGEMENT_URL || 'http://127.0.0.1:15672'
const AUTHORIZATION = `Basic ${Buffer.from('guest:guest').toString('base64')}`

interface ManagementConnection {
  name: string
  client_properties?: { connection_name?: string }
}

const request = async <T>(path: string, method = 'GET'): Promise<T> => {
  const response = await fetch(`${MANAGEMENT_URL}/api${path}`, {
    method,
    headers: { authorization: AUTHORIZATION }
  })
  if (!response.ok) {
    throw new Error(
      `RabbitMQ management ${method} ${path} failed with ${response.status}`
    )
  }
  return (response.status === 204 ? undefined : await response.json()) as T
}

/**
 * Force-closes every broker connection opened with the given connection name, as a network drop or
 * broker-side close would. Waits for the connection to show up first, since the management API
 * lists new connections with a short delay.
 */
export const closeConnections = async (connectionName: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const connections = await request<ManagementConnection[]>('/connections')
    const matching = connections.filter(
      c => c.client_properties?.connection_name === connectionName
    )
    if (matching.length) {
      await Promise.all(
        matching.map(c =>
          request(`/connections/${encodeURIComponent(c.name)}`, 'DELETE')
        )
      )
      return
    }
    await sleep(100)
  }
  throw new Error(`No RabbitMQ connection named ${connectionName} was found`)
}
