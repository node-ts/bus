---
title: Attributes
description: Send values with a message for its receiver, and type them in the handler.
---

# Attributes

::: tip Looking for the correlation id?
This address used to be the correlation id page, which is now [Correlation id](/guide/message-attributes/correlation-id).
:::

Any values can be sent with a message as attributes. Unlike [sticky attributes](/guide/message-attributes/sticky-attributes), they're only for the receiver of that message, and aren't copied to the messages it sends. This page shows how to send and read them.

Attribute values can be strings, numbers or booleans. Set them with `attributes` when sending or publishing:

<<< @/snippets/attributes.ts#send

Handlers receive them in the `attributes` of their second argument. To type them, give the attributes type as the second type argument of `handlerFor`, after the message type:

<<< @/snippets/attributes.ts#handle

The attributes aren't validated when a message is received, so the type is a promise that the sender has to keep.

## See also

- [Sticky attributes](/guide/message-attributes/sticky-attributes)
- [Correlation id](/guide/message-attributes/correlation-id)
