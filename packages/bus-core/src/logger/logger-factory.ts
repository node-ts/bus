import { DebugLogger } from './debug-logger'
import { Logger } from './logger'

export type LoggerFactory = (target: string) => Logger

/**
 * Creates the default logger factory, which writes with `DebugLogger`. Each bus configuration creates
 * its own, so nothing is shared between buses. Loggers are reused for the same target.
 * @returns a logger factory
 */
export const createDefaultLoggerFactory = (): LoggerFactory => {
  const loggers = new Map<string, DebugLogger>()
  return (target: string) => {
    let logger = loggers.get(target)
    if (!logger) {
      logger = new DebugLogger(target)
      loggers.set(target, logger)
    }
    return logger
  }
}
