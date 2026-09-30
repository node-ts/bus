---
'@node-ts/bus-class-serializer': major
'@node-ts/bus-core': major
'@node-ts/bus-messages': major
'@node-ts/bus-mongodb': major
'@node-ts/bus-postgres': major
'@node-ts/bus-rabbitmq': major
'@node-ts/bus-sqs': major
'@node-ts/bus-sqs-lambda': major
---

**Breaking:** each package now has an `exports` map, so only the package root can be imported. Deep imports such as `@node-ts/bus-core/dist/...` now fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`, so import from the package root instead (see [MIGRATING.md](https://github.com/node-ts/bus/blob/master/MIGRATING.md)). Each package also ships an ES module entry for `import`, with its own types, next to the CommonJS entry for `require`. The ES module entry re-exports the CommonJS build, so an app that uses both gets the same classes and singletons (#246).
