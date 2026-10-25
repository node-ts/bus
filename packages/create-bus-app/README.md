# @node-ts/create-bus-app

Creates a new TypeScript service on [@node-ts/bus](https://node-ts.github.io/bus), with the transport and persistence you choose, a handler, a workflow, tests, docker compose and a Dockerfile.

[![npm](https://img.shields.io/npm/v/@node-ts/create-bus-app)](https://www.npmjs.com/package/@node-ts/create-bus-app)

**[Documentation](https://node-ts.github.io/bus/getting-started/create-app)** · [Changelog](https://github.com/node-ts/bus/blob/master/packages/create-bus-app/CHANGELOG.md)

## Installation

Requires Node.js 24 or later.

There's nothing to install: run it with your package manager's `create` command.

## Usage

```sh
npm create @node-ts/bus-app my-service
```

In a terminal, it asks for the directory, the transport and the persistence. To choose without being asked, give them after `--`:

```sh
npm create @node-ts/bus-app my-service -- --transport rabbitmq --persistence mongodb --yes
```

It creates the app in a new or empty directory, installs nothing, and prints the next steps. `pnpm create @node-ts/bus-app` and `yarn create @node-ts/bus-app` work too, and the next steps use the package manager you ran it with.

## Configuration

| Option                     | Default    | Description                                                                         |
| -------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `[directory]`              | `bus-app`  | Where to create the app. Its name is the package's name and the queue's             |
| `-t, --transport <name>`   | `postgres` | `postgres`, `rabbitmq`, `sqs` (LocalStack in development) or `redis`                |
| `-p, --persistence <name>` | `postgres` | `postgres` or `mongodb`                                                             |
| `-y, --yes`                |            | Ask nothing, and take the defaults for what isn't given. It's on without a terminal |

## Learn more

- [Creating an app](https://node-ts.github.io/bus/getting-started/create-app)
- [Handling messages](https://node-ts.github.io/bus/getting-started/handling-messages)
- [Provisioning](https://node-ts.github.io/bus/guide/provisioning)
