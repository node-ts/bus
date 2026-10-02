---
title: Lifecycle hooks
description: Listen for messages being sent, published, received, dispatched and failing.
---

# Lifecycle hooks

A bus emits events as it sends, publishes, receives and handles messages. This page lists them and shows how to listen for them, for logging, metrics or auditing.

Each hook is an emitter on the bus. `on()` adds a listener and returns a function that removes it. `once()` listens for the next event only, and `off()` removes a listener.

<<< @/snippets/lifecycle-hooks.ts#on

Listeners are called synchronously and aren't awaited. If one returns a promise that rejects, the bus logs it.

## Hooks

| Hook             | Emitted                                                   | With                                           |
| ---------------- | --------------------------------------------------------- | ---------------------------------------------- |
| `beforeSend`     | before a command is sent to the transport                 | `command`, `attributes`                        |
| `afterSend`      | after the transport has sent a command                    | `command`, `attributes`                        |
| `beforePublish`  | before an event is published to the transport             | `event`, `attributes`                          |
| `afterPublish`   | after the transport has published an event                | `event`, `attributes`                          |
| `afterReceive`   | after a message is read from the queue, before middleware | `message`, the transport's message             |
| `beforeDispatch` | before a message is dispatched to its handlers            | `message`, `attributes`, `handlers`            |
| `afterDispatch`  | after every handler of a message has succeeded            | `message`, `attributes`                        |
| `onError`        | when reading, dispatching or handling a message fails     | `message`, `error`, `attributes`, `rawMessage` |

Messages sent from inside a handler are held until it resolves, so `beforeSend` and `beforePublish` fire when the handler sends them, and `afterSend` and `afterPublish` once they've been sent.

<<< @/snippets/lifecycle-hooks.ts#hooks

## See also

- [Middleware](/guide/middleware), to wrap the handling of each message
- [`BusInstance`](/api/bus-core/classes/BusInstance) in the API reference
