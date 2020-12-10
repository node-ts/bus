import { Logger } from '@node-ts/logger-core'

let configuredLogger: Logger | undefined
const defaultLogger = {} as Logger
export const getLogger = () => configuredLogger || defaultLogger
export const setLogger = (logger: Logger) => configuredLogger = logger
