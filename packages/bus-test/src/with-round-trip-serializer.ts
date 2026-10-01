import { ClassSerializer } from '@node-ts/bus-class-serializer'
import { BusConfiguration } from '@node-ts/bus-core'

/**
 * Configures how every bus in the suite restores the types of the messages and workflow state
 * it reads. It's the only place the round trip suites depend on the serializer, so the same
 * assertions run against whichever mechanism is configured here.
 */
export const withRoundTripSerializer = (
  configuration: BusConfiguration
): BusConfiguration => configuration.withSerializer(new ClassSerializer())
