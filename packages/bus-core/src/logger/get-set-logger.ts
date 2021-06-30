import { DebugLogger } from './debug-logger'
import { Logger } from './logger'

export type LoggerFactory = (target: string) => Logger

let configuredLoggerFactory: LoggerFactory | undefined

/*
  Keep a lookup of existing loggers so that loggers are reused between invocations for
  the same target.
*/
const defaultLoggers: { [key: string]: DebugLogger } = {}

export const defaultLoggerFactory: LoggerFactory = (target: string) => {
  if (!defaultLoggers[target]) {
    defaultLoggers[target] = new DebugLogger(target)
  }

  return defaultLoggers[target]
}

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
