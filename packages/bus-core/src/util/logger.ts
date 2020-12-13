import { ConsoleLogger, Logger } from '@node-ts/logger-core'

let configuredLogger: Logger | undefined
const defaultLogger = new ConsoleLogger('bus')
const getLogger = () => configuredLogger || defaultLogger
const setLogger = (logger: Logger) => configuredLogger = logger

export { getLogger, setLogger, Logger }
