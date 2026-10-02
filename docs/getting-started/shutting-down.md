---
title: Shutting down cleanly
description: Let the bus finish the messages it's handling before your application exits.
next:
  text: Messages
  link: /guide/messages
---

# Shutting down cleanly

An application should finish the messages it has read from the queue, and read no more, before it exits. That happens when you press Ctrl+C, when a process manager sends a signal such as `kill -INT 1234`, or when the pod, container or host it runs on is stopping. This page covers what the bus does by default and how to take over shutdown yourself.

## The default

A bus that handles messages listens for `SIGINT` and `SIGTERM`, and stops when it receives one: it stops reading from the queue and waits for the handlers that are running to finish. The process then exits once nothing else keeps it running, such as an open connection to the transport.

## Disposing the bus yourself

To close the transport and persistence connections too, so the process exits, listen for the signals yourself and call `bus.dispose()`. Pass `withInterruptSignals([])` so the bus doesn't also listen for them. Hosts that own shutdown, such as NestJS or AWS Lambda, need this too.

<<< @/snippets/shutting-down.ts#dispose

To stop on other signals as well, pass all the signals the bus should listen for. They replace the defaults:

<<< @/snippets/shutting-down.ts#signals

Send-only buses never listen for signals.

## See also

- [Lifecycle hooks](/guide/lifecycle-hooks)
- [Long running processes](/guide/long-running-processes), for work that takes longer than a shutdown can wait
- [`BusInstance`](/api/bus-core/classes/BusInstance) in the API reference
