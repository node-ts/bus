import { DebugLogger } from './debug-logger'
import { Logger } from './logger'

export type LoggerFactory = (target: string) => Logger

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
