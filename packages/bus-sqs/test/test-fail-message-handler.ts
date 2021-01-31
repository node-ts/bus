import { Bus, Handler, HandlerContext } from '@node-ts/bus-core'
import { TestFailMessage } from './test-fail-message'


export const TestFailMessageHandler: Handler<TestFailMessage> = async (_: HandlerContext<TestFailMessage>) => Bus.fail()
