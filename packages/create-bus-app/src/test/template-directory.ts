import { join } from 'node:path'

/**
 * The template in this repository
 */
export const TEMPLATE_DIRECTORY = join(__dirname, '..', '..', 'template')

/**
 * Versions of the packages the template depends on, as the build records them
 */
export const TEST_VERSIONS: Record<string, string> = {
  '@node-ts/bus-cli': '2.0.0',
  '@node-ts/bus-core': '2.1.0',
  '@node-ts/bus-messages': '2.0.1',
  '@node-ts/bus-mongodb': '2.0.0',
  '@node-ts/bus-postgres': '2.0.0',
  '@node-ts/bus-rabbitmq': '2.0.0',
  '@node-ts/bus-redis': '2.0.0',
  '@node-ts/bus-sqs': '2.0.0'
}
