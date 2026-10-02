---
title: Long running processes
description: Run tasks that take longer than a message can be held for, such as encoding a video, without blocking handlers.
---

# Long running processes

Some tasks can't finish within the time a message can be held, such as encoding a video or preparing a large file for download. This page explains why they shouldn't run in a handler, and an approach that works.

## Why not in a handler

When a message is read from the queue, it has to be handled and deleted within a timeout, usually 30 seconds to a few minutes. If it isn't, the queue assumes the consumer died, and makes the message visible again for another consumer, which starts the same work. After a number of attempts, the message goes to the dead letter queue.

A long task in a handler also blocks that worker from handling other messages while it waits. Handlers should finish as quickly as they can.

Say a command, `EncodeVideo`, can take up to an hour. Its handler can't wait for the encoding to finish. Instead, it should start the work somewhere else, and events should report its progress.

## A naive approach

One way that's **not recommended** is to run the task in the background:

<<< @/snippets/long-running-processes.ts#naive

The command is deleted straight away, but:

- Nothing retries the task if it fails, and nothing publishes a message to say it did.
- Nothing balances the load. One instance may receive every `EncodeVideo` command and run hundreds of tasks until it crashes.
- When the service restarts, the tasks running in the background are lost and not retried.

## A task per job

If your application runs on Kubernetes, ECS, Docker Swarm or similar, start a container task for each job, and leave it to the scheduler to place it. Scaling then follows the number of jobs. The handler starts the task and returns:

<<< @/snippets/long-running-processes.ts#task

The task publishes an event such as `VideoEncoded` when it's done.

### Recovering from failed tasks

Starting tasks from handlers doesn't help when a task fails or the scheduler stops it. A [workflow](/guide/workflows) can track each job: start it on `VideoEncodingStarted`, listen for the scheduler's [system messages](/guide/messages/system-messages) that report a task exited, start the task again when needed, and complete on `VideoEncoded`.

## See also

- [Workflows](/guide/workflows)
- [System messages](/guide/messages/system-messages)
