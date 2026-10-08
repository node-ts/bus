import { Logger as NestLogger } from '@nestjs/common'
import { Logger, LoggerFactory } from '@node-ts/bus-core'

/**
 * Passes the context object to Nest's logger only when there is one, so it doesn't print `undefined`
 */
const withMeta = (meta: object | undefined): object[] =>
  meta === undefined ? [] : [meta]

/**
 * A logger factory that writes the bus' logs with Nest's `Logger`, with the bus component as the context, so they
 * follow the application's logger and log levels. `BusModule` configures every bus with it, unless `configure`
 * calls `withLogger()`. The bus' `trace` logs are Nest's `verbose`, and its `info` logs are Nest's `log`.
 * @param target the bus component, such as `@node-ts/bus-core:service-bus`
 * @returns a logger for the component
 * @example
 * Bus.configure().withLogger(nestLoggerFactory)
 */
export const nestLoggerFactory: LoggerFactory = (target: string): Logger => {
  const logger = new NestLogger(target)
  return {
    debug: (message, meta) => logger.debug(message, ...withMeta(meta)),
    trace: (message, meta) => logger.verbose(message, ...withMeta(meta)),
    info: (message, meta) => logger.log(message, ...withMeta(meta)),
    warn: (message, meta) => logger.warn(message, ...withMeta(meta)),
    error: (message, meta) => logger.error(message, ...withMeta(meta)),
    fatal: (message, meta) => logger.fatal(message, ...withMeta(meta))
  }
}
