---
title: Several buses
description: Run several buses in one process, each isolated as if it ran in its own, and share a serializer or persistence between them.
---

# Several buses

A process can run more than one bus, such as a service that reads from two queues. This page covers how buses in one process are kept apart, and what they can share.

## Each bus is isolated

Each bus behaves as if it ran in its own process. Its message types, handling context, lifecycle hooks and default logger are its own, and nothing is kept in module or global state.

So a bus used inside another bus' handler doesn't know about the message being handled:

- Messages it sends start a new correlation, and don't get the sticky attributes of the message being handled.
- Its `failMessage()` and `returnMessage()` throw `FailMessageOutsideHandlingContext` and `ReturnMessageOutsideHandlingContext`, since that bus isn't handling a message.

To send, publish, fail or return as part of handling a message, use the handler's [`HandlerContext`](/api/bus-core/interfaces/HandlerContext), or the bus that's handling it.

## What buses can share

A transport instance holds one queue and one connection, so each bus needs its own: building a second bus with the same transport instance throws `TransportAlreadyInUse`.

A serializer or a persistence can be shared, since each bus passes its own message types to them. A shared persistence is disposed when the last bus that uses it is disposed.

<<< @/snippets/multiple-buses.ts#shared

## See also

- [Transports](/transports)
- [Persistence](/persistence)
- [Correlation id](/guide/message-attributes/correlation-id)
