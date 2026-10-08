import { LoggerService } from '@nestjs/common'

/**
 * The logger of the tests' Nest applications, which the bus also logs through. It drops everything, unless
 * BUS_TEST_LOGS=true, to see the logs when debugging a failing test.
 */
export const testLogger = (): LoggerService | false =>
  process.env.BUS_TEST_LOGS === 'true' ? false : SILENT_LOGGER

const ignore = (): void => undefined

const SILENT_LOGGER: LoggerService = {
  log: ignore,
  error: ignore,
  warn: ignore,
  debug: ignore,
  verbose: ignore,
  fatal: ignore
}
