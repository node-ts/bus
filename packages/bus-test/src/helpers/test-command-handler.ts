import { Handler } from '@node-ts/bus-core'
import { HandleChecker } from './handle-checker'
import { TestCommand } from './test-command'

export const testCommandHandler = (handleChecker: HandleChecker): Handler<TestCommand> =>
  (message, attributes) => handleChecker.check(message, attributes)