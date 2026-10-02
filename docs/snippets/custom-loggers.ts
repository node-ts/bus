import { Bus, Logger } from '@node-ts/bus-core'
import winston from 'winston'

// #region winston
export class WinstonLogger implements Logger {
  private readonly logger: winston.Logger

  /**
   * @param name The name of the component that writes to this logger, such
   * as `@node-ts/bus-core:service-bus`
   */
  constructor(name: string) {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      defaultMeta: { name },
      transports: [new winston.transports.Console()]
    })
  }

  trace(message: string, meta?: object): void {
    this.logger.silly(message, meta)
  }

  debug(message: string, meta?: object): void {
    this.logger.debug(message, meta)
  }

  info(message: string, meta?: object): void {
    this.logger.info(message, meta)
  }

  warn(message: string, meta?: object): void {
    this.logger.warn(message, meta)
  }

  error(message: string, meta?: object): void {
    this.logger.error(message, meta)
  }

  fatal(message: string, meta?: object): void {
    this.logger.error(message, { ...meta, fatal: true })
  }
}
// #endregion winston

// #region configure
const bus = Bus.configure()
  // Called once for each component that logs
  .withLogger(name => new WinstonLogger(name))
  .build()
// #endregion configure

await bus.initialize()
