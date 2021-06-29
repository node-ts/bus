import { DebugLogger } from './debug-logger'
import { Logger } from './logger'

export type LoggerFactory = (target: string) => Logger

let configuredLoggerFactory: LoggerFactory | undefined

const defaultLoggerFactory: LoggerFactory = (target: string) => new DebugLogger(target)

/**
 * Create or get a logger for a specific target
 */
export const getLogger = (target: string) => {
  const logger = configuredLoggerFactory || defaultLoggerFactory
  return logger(target)
}

/**
 * Set the logger factory that will be called when getting a logger
 * for a specific target
 */
export const setLogger = (logger: LoggerFactory) => configuredLoggerFactory = logger
