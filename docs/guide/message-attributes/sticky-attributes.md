---
title: Sticky attributes
description: Attributes that are copied to every message sent while handling a message, and to the messages after them.
---

# Sticky attributes

Sticky attributes are like [attributes](/guide/message-attributes/attributes), except that they're copied to every message sent or published while the message is handled, and from those to the next, all the way down the flow. This page shows how to send and read them.

Use them for context that the whole flow needs, such as a tenant id or the user that started it. Set them with `stickyAttributes`:

<<< @/snippets/sticky-attributes.ts#send

Handlers receive them in the `stickyAttributes` of their second argument. Type them with the second type parameter of `MessageAttributes`:

<<< @/snippets/sticky-attributes.ts#handle

[Workflows](/guide/workflows) use a sticky attribute to route replies back to the workflow that sent a command.

## See also

- [Correlation id](/guide/message-attributes/correlation-id), which propagates the same way
- [Handling](/guide/workflows/handling) in workflows
