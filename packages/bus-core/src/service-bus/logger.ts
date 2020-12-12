import { Logger } from '@node-ts/logger-core'

let configuredLogger: Logger | undefined
const defaultLogger = {} as Logger
const getLogger = () => configuredLogger || defaultLogger
const setLogger = (logger: Logger) => configuredLogger = logger

export { getLogger, setLogger, Logger }
