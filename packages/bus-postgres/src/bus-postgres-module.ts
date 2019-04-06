import { ContainerModule } from 'inversify'
import { BUS_WORKFLOW_SYMBOLS } from '@node-ts/bus-workflow'
import { PostgresPersistence } from './postgres-persistence'
import { bindLogger } from '@node-ts/logger-core'
import { BUS_POSTGRES_INTERNAL_SYMBOLS, BUS_POSTGRES_SYMBOLS } from './bus-postgres-symbols'
import { Pool } from 'pg'
import { PostgresConfiguration } from './postgres-configuration'

export class BusPostgresModule extends ContainerModule {
  constructor () {
    super ((bind, _, __, rebind) => {
      rebind(BUS_WORKFLOW_SYMBOLS.Persistence).to(PostgresPersistence).inSingletonScope()
      bindLogger(bind, PostgresPersistence)

      bind(BUS_POSTGRES_INTERNAL_SYMBOLS.PostgresPool)
        .toDynamicValue(context => {
          const postgresConfiguration = context.container.get<PostgresConfiguration>(
            BUS_POSTGRES_SYMBOLS.PostgresConfiguration
          )
          return new Pool(postgresConfiguration.connection)
        })
        .inSingletonScope()
    })
  }
}
