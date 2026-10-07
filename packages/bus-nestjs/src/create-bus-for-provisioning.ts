import { DynamicModule, LoggerService, LogLevel, Type } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { BusInstance } from '@node-ts/bus-core'
import { BUS_PROVISIONING, BusProvisioningModule } from './bus-provisioning'
import { getBusToken } from './get-bus-token'

/**
 * Options for `createBusForProvisioning()`
 */
export interface CreateBusForProvisioningOptions {
  /**
   * The name of the bus to return, as given to `BusModule.forRoot({ name })`
   * @default 'default'
   */
  bus?: string
  /**
   * The logger, or log levels, of the application it creates. Nest writes most logs to stdout, which would mix
   * with `bus provision --json`'s report.
   * @default ['error']
   */
  logger?: LoggerService | LogLevel[] | false
}

/**
 * Creates the application as a standalone application context in which each `BusModule` builds its bus but doesn't
 * initialize, start or dispose it, and returns the bus, for `bus provision` from @node-ts/bus-cli. The bus has the
 * handlers and workflows of every module, just as when the application runs.
 *
 * The application is never closed: `bus provision` disposes the bus and then exits. Creating it runs the
 * `onModuleInit` and `onApplicationBootstrap` hooks of the application's other providers, so keep side effects that
 * shouldn't happen on a deploy, such as starting a scheduled job, out of them or behind configuration.
 * @param appModule the application's root module
 * @param options which bus to return, and the application's logger
 * @returns the bus, built but not initialized
 * @example
 * // src/provision-bus.ts, run with `bus provision dist/provision-bus.js`
 * export default () => createBusForProvisioning(AppModule)
 */
export const createBusForProvisioning = async (
  appModule: Type | DynamicModule,
  options: CreateBusForProvisioningOptions = {}
): Promise<BusInstance> => {
  const provisioningModule: DynamicModule = {
    module: BusProvisioningModule,
    global: true,
    providers: [{ provide: BUS_PROVISIONING, useValue: true }],
    exports: [BUS_PROVISIONING]
  }
  // A class of its own for each application, so its module is never confused with another's
  class BusProvisioningApplication {}
  const app = await NestFactory.createApplicationContext(
    {
      module: BusProvisioningApplication,
      imports: [appModule, provisioningModule]
    },
    { logger: options.logger ?? ['error'], abortOnError: false }
  )
  return app.get<BusInstance>(getBusToken(options.bus), { strict: false })
}
