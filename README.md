# @node-ts/bus

[![Greenkeeper badge](https://badges.greenkeeper.io/node-ts/bus.svg)](https://greenkeeper.io/)

An enterprise service bus for distributed node applications.

This library is inspired by [Enterprise Integration Patterns](https://www.enterpriseintegrationpatterns.com/), as well as other message based libraries such as [NServiceBus](https://particular.net/nservicebus) for .NET and [Mule ESB](https://www.mulesoft.com/resources/esb/what-mule-esb) for Java. It provides a simple way to send and receive messages in node.

## Message Handling

Handling messages requires you to provide a handler function that will be invoked with a message as it is received from the bus. Once the handling function is registered, this library will take care of dispatching, retries, subscription of the message to your messaging technology, logging etc. 

For more information, see [@node-ts/bus-core](https://www.npmjs.com/package/@node-ts/bus-core)

## Long Running Processes

One common attribute of business domains is that they often involve long running processes. These are a series of steps that are orchestrated over a period of time that combine different parts of the business operation. 

For more information, see [@node-ts/bus-workflow](https://www.npmjs.com/package/@node-ts/bus-workflow)


## Domain Driven Design

Domain Driven Design (DDD) is an approach to software development to keep complexity low even as the size of a project grows larger. It encourages a separation of the domain code that models the business and its functions from the technical code that does all the "other stuff" like apis, databases, frontends etc. 

This library is compatible with [@node-ts/ddd](https://www.npmjs.com/node-ts/ddd) that provides a DDD framework that's message bus ready. Together they bring the ability to write large enterprise applications using just Typescript and node. 
