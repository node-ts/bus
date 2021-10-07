import { handlerFor } from '@node-ts/bus-core'
import { HandleChecker } from './handle-checker'
import { TestCommand } from './test-command'

export const testCommandHandler = (handleChecker: HandleChecker) =>
  handlerFor(
    TestCommand,
    (message, attributes) => handleChecker.check(message, attributes)
  )
