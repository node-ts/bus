---
'@node-ts/bus-class-serializer': major
'@node-ts/bus-core': major
'@node-ts/bus-messages': major
'@node-ts/bus-mongodb': major
'@node-ts/bus-postgres': major
'@node-ts/bus-rabbitmq': major
'@node-ts/bus-sqs': major
'@node-ts/bus-sqs-lambda': major
'@node-ts/bus-test': major
---

**Breaking:** Node.js 24 is now the minimum supported runtime (`engines.node >=24`). The packages are compiled against `@tsconfig/node24` (ES2024), and their dependencies have been upgraded to current versions (#279).

Every `@node-ts/bus` package is released as 2.0.0, and the adapters now peer on `@node-ts/bus-core` `^2.0.0`, so upgrade them together. See the [2.0 migration guide](https://github.com/node-ts/bus/blob/master/MIGRATING.md).
