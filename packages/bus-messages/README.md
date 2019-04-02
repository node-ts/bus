# @node-ts/bus-messages

[![Greenkeeper badge](https://badges.greenkeeper.io/node-ts/bus.svg)](https://greenkeeper.io/)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)

This package should be consumed wherever your application defines message contracts. Messages are small pieces of data that get passed around between services. They can define an instruction to perform an action, or report that something has just occurred.

`@node-ts/bus-messages` defines three types of messages:

## Command

Commands are a type of message that represents an instruction to do work. These can be technical instructions such as `BackupDatabase`, `ScaleOutLoadBalancer`, or modeled after your business domains like `ChargeCreditCard`, `PostMerchandise`.

A commands are sent to a single service for processing, and generally result in the publication of one or more `Events`

## Event

An event is a message emitted by the system when "something" happens. Again this could be a technical task being completed such as `DatabaseBackedup`, `LoadBalancerScaledOut` or as a result of changes in your business `CreditCardCharged`, `MerchandisePosted`.
