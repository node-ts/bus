import { ConsoleLogger } from '@node-ts/logger-core'

/**
 * This is the same logger definition as in @node-ts/logger-core. It's added
 * here for brevity so that @node-ts/logger-core doesn't need to be imported
 * whilst it still has the hard dependency on inversify.
 *
 * Because it's the same shape, duck typing should allow this to be used
 * interchangeably with other packages that consume @node-ts/logger-core
 */
interface Logger {
  debug (message: string, meta?: object): void
  trace (message: string, meta?: object): void
  info (message: string, meta?: object): void
  warn (message: string, meta?: object): void
  error (message: string, meta?: object): void
  fatal (message: string, meta?: object): void
}


let configuredLogger: Logger | undefined
const defaultLogger = new ConsoleLogger('bus')
const getLogger = () => configuredLogger || defaultLogger
const setLogger = (logger: Logger) => configuredLogger = logger

export { getLogger, setLogger, Logger }
