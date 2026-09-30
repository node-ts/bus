import debug, { Debugger } from 'debug'
import { Logger } from './logger'

/**
 * The default logger based on the `debug` package. To see all log output, run
 * the application with `DEBUG=@node-ts/bus-*` set as an environment variable.
 *
 * Warnings, errors and fatal errors are always written to stderr so that failures are visible
 * without `DEBUG` set. When `DEBUG` is enabled for the logger's namespace they're written by `debug`
 * along with the rest of the output instead.
 */
export class DebugLogger implements Logger {
  private logger: Debugger

  /**
   * @param name The namespace of the logger, such as `@node-ts/bus-core:service-bus`
   * @param consoleOutput Where warnings and errors are written when `DEBUG` isn't enabled for `name`
   * @default consoleOutput console
   */
  constructor(
    name: string,
    private readonly consoleOutput: Pick<Console, 'warn' | 'error'> = console
  ) {
    this.logger = debug(name)
  }

  private log(message: string, meta?: object): void {
    meta ? this.logger(message, meta) : this.logger(message)
  }

  private logToConsole(
    level: 'warn' | 'error',
    message: string,
    meta?: object
  ): void {
    if (this.logger.enabled) {
      this.log(message, meta)
      return
    }
    const line = `${this.logger.namespace} ${message}`
    meta
      ? this.consoleOutput[level](line, meta)
      : this.consoleOutput[level](line)
  }

  debug(message: string, meta?: object): void {
    this.log(message, meta)
  }
  trace(message: string, meta?: object): void {
    this.log(message, meta)
  }
  info(message: string, meta?: object): void {
    this.log(message, meta)
  }
  warn(message: string, meta?: object): void {
    this.logToConsole('warn', message, meta)
  }
  error(message: string, meta?: object): void {
    this.logToConsole('error', message, meta)
  }
  fatal(message: string, meta?: object): void {
    this.logToConsole('error', message, meta)
  }
}
