# bus-cli

The `bus` command line. Read the root `CLAUDE.md` first.

- `bus.mjs` is the bin. It's committed outside `dist` (and `bin/` is gitignored) so pnpm links it into the workspace before the package is built. It only calls `runCli` from `dist/cli.js`. Add commands to `COMMANDS` in `src/cli.ts`, one folder per command (#283 and #269 add more).
- `generate-message-types` reads the project with the TypeScript compiler API, read-only. `MessageTypeReader` walks exported, non-abstract classes with a `$name` declared in the entry files (re-exports are skipped), and records only the fields that need restoring. Anything it can't describe is pushed onto `problems` rather than thrown, so one run reports every problem. `message-types-model.ts` must stay in step with `MessageFieldType`/`MessageTypes` in `@node-ts/bus-messages` and the reviver in `bus-core/src/serialization/message-type-reviver.ts`.
- `writeMessageTypes` emits the file. Imports end in `.js` under `node16`/`nodenext` module resolution, and have no extension otherwise. Class keys double as import names, so they're made unique (`Address_2`) and avoid the names the file declares.
- `--check` and regeneration compare files with `isSameMessageTypes`, which ignores formatting, quotes and import order, so formatters can touch the generated file.
- Tests: `src/generate-message-types/generate-message-types.spec.ts` runs against the fixture projects in `test/supported` and `test/unsupported` (each with its own tsconfig). `run-generate-message-types.integration.ts` copies `test/supported` into `tmp/` (gitignored, inside the package so `@node-ts/bus-messages` resolves), runs the CLI, type-checks the result, transpiles it file by file and round trips a message through `JsonSerializer`.
