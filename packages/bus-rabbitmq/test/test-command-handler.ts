import { HandlerContext } from '@node-ts/bus-core'
import { TestCommand } from './test-command'

export const testCommandHandler = (_: HandlerContext<TestCommand>) => undefined
