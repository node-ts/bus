import { LoggerService } from '@nestjs/common'

/**
 * A Nest logger that records each call, with its level first
 */
export class RecordingLogger implements LoggerService {
  readonly calls: unknown[][] = []

  log(...args: unknown[]): void {
    this.calls.push(['log', ...args])
  }

  error(...args: unknown[]): void {
    this.calls.push(['error', ...args])
  }

  warn(...args: unknown[]): void {
    this.calls.push(['warn', ...args])
  }

  debug(...args: unknown[]): void {
    this.calls.push(['debug', ...args])
  }

  verbose(...args: unknown[]): void {
    this.calls.push(['verbose', ...args])
  }

  fatal(...args: unknown[]): void {
    this.calls.push(['fatal', ...args])
  }
}
