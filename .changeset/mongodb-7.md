---
'@node-ts/bus-mongodb': minor
---

**Breaking:** upgrade the `mongodb` driver from 5 to 7 (MongoDB server 4.2 or later). `MongodbPersistence` takes a `MongoClient` from `mongodb` 7, so upgrade your own copy of the driver to match (#279).
