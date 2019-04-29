---
title: "@node-ts/bus"
sidebarDepth: 3
---

# @node-ts/bus

[![Greenkeeper badge](https://badges.greenkeeper.io/node-ts/bus.svg)](https://greenkeeper.io/)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)

An enterprise service bus for distributed node applications.

View our docs at [https://node-ts.github.io/bus/](https://node-ts.github.io/bus/)

This library is inspired by [Enterprise Integration Patterns](https://www.enterpriseintegrationpatterns.com/), as well as other message based libraries such as [NServiceBus](https://particular.net/nservicebus) for .NET and [Mule ESB](https://www.mulesoft.com/resources/esb/what-mule-esb) for Java. It provides a simple way to send and receive messages in node.

## Overview

This library is a service bus for Node. A service bus offers a way to connect one or many backend systems, and also a method of making a single application resilient and durable. It helps to decouple and greatly simplify applications, especially as they grow larger.

The simplest way to imagine an ESB based system is the following:

- Your system, as a whole, can accept and process `commands`
- When a command is executed, one or more `events` are published
- The system can listen for certain `events` and trigger other `commands` because of it

For example consider an online hotel booking ESB-based system:

- A `command` like `ReserveRoom` is sent when a new reservation is made
- Upon processing this `command`, a `RoomReserved` event is published
- Whenever a `RoomReserved` `event` is received, a `SendEmailToHotel` `command` is sent

This library can be combined with the Domain Driven Design library [@node-ts/ddd](https://www.github.com/node-ts/ddd) that helps align software with the business domain.

## Components

This library consists of the following main components:

### Message Handlers

Message handlers are simple, stateless functions that are invoked each time a message that your application subscribes to is received. They take the message as an argument, perform an action based on the message, and then complete. 

For more information, see [@node-ts/bus-core](packages/bus-core/src/handler/)

### Workflows

Workflows orchestrate the business process logic in your application. Business processes are specific to your application and problem domain, and can be anything from carrying out the steps of an eCommerce site to process an order through to fulfilment, to managing a marketing campaign from start to finish.

Workflows are crucial in decoupling your application and keeping the "how to do something" separate from the "when to do something".

For more information, see [@node-ts/bus-workflow](/packages/bus-workflow/)

### Transports

Transports are message brokers that are use by this library for communication. RabbitMQ, AWS SQS, Kafka, MSMQ etc are all examples of message queueing technology that can be used. The choice of transport is largely irrelevant for the developer, as this library abstracts all of those complexities away. 

Currently transport adapters for RabbitMQ and AWS SQS have been written, but implementing one for a different technology is simple.

For more information, see [@node-ts/bus-core/transport](/packages/bus-core/transport/)

