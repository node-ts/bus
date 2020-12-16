# Handlers

Message handlers are stateless functions that receive messages and perform an action. Once this action has completed, the message is considered processed and is removed from the underlying transport.

If an error is thrown during the processing of the message, then the message is placed back onto the queue so that it can again be handled and the action retried.

## Implementation

Each message handler is a new class definition. Handlers can receive any type of message from `@node-ts/bus-messages`, ie: `Command`, `Event`, or `Message`. 

```typescript
// send-welcome-email-handler.ts
import { Handler } from '@node-ts/bus-core'
import { SendWelcomeEmail } from 'contracts'
import { emailService } from 'domain'

/**
 * Handles all `SendWelcomeEmail` messages and delegates them through to the emailService to send a welcome email
 */
export const handleSendWelcomeEmail: Handler<SendWelcomeEmail> = async ({ message }) => emailService.sendWelcomeEmail(message)
```

The next step is to register the handler with the `Bus` so that the underlying transport can be configured and subscribed to the various topics:

```typescript
// application.ts
import { Bus } from '@node-ts/bus-core'
import { handleSendWelcomeEmail } from './handle-send-welcome-email'

const run = async () => {
  await Bus
    .configure()
    .withHandler(SendWelcomeEmail, handleSendWelcomeEmail)
    .initialize()

  await Bus.start()
}

run.then(() => undefined)
```

## Consuming messages

Messages read from the underlying transport aren't immediately removed. Instead, a read lock or visibility flag is placed on the message at the transport so that it won't be read by other consumers. These flags are designed to be relatively short lived, around 30 seconds or so, as the handler is expected to process the message quickly so that the message can be removed. 

## Receiving message options, attributes and metadata

Additional metadata can be sent along with messages that don't belong to the message body, but is instead added to the message headers or attributes as metadata. This is sent to messages handlers as a second, optional parameter. For example:

```typescript
import { Handler } from '@node-ts/bus-core'

export const handleWithAttributes: Handler<Command> = ({ context }) =>
  console.log('The user id sent in the message attributes is', context.attributes.userId)
```

## Messages that fail processing

When a message handling function throws an error while processing a message, the message is returned to the queue to be retried. Often the message will succeed on a subsequent retry depending on the reason for the error (eg: a core piece of infrastructure was down, an external service was unavailable, a network partition event occurred, a row lock version conflict stopped an update going through).

There are instances when a message is considered `poisoned` and will never process successfully regardless of the number of retry attempts. Such situations occur because of bugs, manual modification of database rows, etc. After the message has been retried a number of times (generally 10 attempts), then the message will be forwarded to the dead letter queue. 

## Long Running Processes

There are occasions where messages need to perform a long running process such as backing up a database or encoding a video. Because these processes can go well beyond the 30 second handling window, they can't be processed the normal way.

Instead, the action of the message handling function should be to start the process running. This could be a docker container, cloud service task, remote process etc. Once that process completes then it should emit an event reporting the completion of the process. 

This then treats the process as asynchronous. Ie: an event is raised when the process starts, and another to report that the process has completed.

For more information on coordinating long running processes and higher-order logic, see [@node-ts/bus-core/workflow](/packages/bus-core/src/workflow)