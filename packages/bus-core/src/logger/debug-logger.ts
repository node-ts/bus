import { Logger } from './logger'
import debug, { Debugger } from 'debug'

/**
 * The default logger based on the `debug` package. To see log output, run
 * the application with `DEBUG=@node-ts/bus-*` set as an environment variable.
 */
export class DebugLogger implements Logger {
  private logger: Debugger

  constructor(name: string) {
    this.logger = debug(name)
  }

  private log(message: string, meta?: object): void {
    meta ? this.logger(message, meta) : this.logger(message)
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
    this.log(message, meta)
  }
  error(message: string, meta?: object): void {
    this.log(message, meta)
  }
  fatal(message: string, meta?: object): void {
    this.log(message, meta)
  }
}
