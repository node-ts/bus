import { SqsTransport } from './sqs-transport'
import { TestContainer } from '../test'
import { BUS_SYMBOLS, ApplicationBootstrap } from '@node-ts/bus-core'

describe('SqsTransport', () => {
  let container: TestContainer
  let sut: SqsTransport
  let bootstrap: ApplicationBootstrap

  beforeAll(async () => {
    container = new TestContainer()
    sut = container.get(BUS_SYMBOLS.Transport)

    bootstrap = container.get(BUS_SYMBOLS.ApplicationBootstrap)
    await bootstrap.initialize(container)
  })

  afterAll(async () => {
    await bootstrap.dispose()
  })

  xit('should have integration tests')

})
