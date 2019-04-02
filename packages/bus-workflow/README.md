# @node-ts/bus-workflow

[![Greenkeeper badge](https://badges.greenkeeper.io/node-ts/bus.svg)](https://greenkeeper.io/)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)

Workflows (aka sagas, process managers, long running processes, message driven state machines), are a way to orchestrate higher level logic over a distributed or reliable/durable system. This is a key [enterprise integration pattern](https://www.enterpriseintegrationpatterns.com/patterns/messaging/ProcessManager.html).

![Workflow](assets/workflow.gif?raw=true "Workflow")

Workflows are often started by a particular event (eg: `OrderPlaced`) and coordinate all the activities to complete a process. In this case, the workflow would be responsible for fulfilling an order, which may mean capturing payment, picking inventory, shipping, sending receipts etc. These steps may be independent of one another, or dependent and must be executed in order. The process may take a few seconds, or a few weeks. 

Regardless of these behaviours, the workflow will listen for events that signal the completion of each step, and may send out commands to invoke the next step. Once all steps have completed, the workflow will flag itself as complete and no further actions will be taken by it.

## Installation

Ideally services that host workflows should be somewhat isolated and contain no other concerns. 

```bash
npm i reflect-metadata inversify @node-ts/bus-workflow @node-ts/bus-core
```
