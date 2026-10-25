import type { BusInstance, PruningPlan } from '@node-ts/bus-core'
import { parseArgs } from 'node:util'
import { CommandOutput } from '../generate-message-types/run-generate-message-types'
import {
  BusConfigurationModuleNotLoaded,
  BusConfigurationNotExported
} from '../provision/error'
import {
  ImportModule,
  importModule,
  loadBusConfiguration
} from '../provision/load-bus-configuration'
import { formatPruneReport } from './format-prune-report'
import { PruneReport } from './prune-report'

export const PRUNE_USAGE = `Usage: bus prune <module> [options]

Builds the bus a module exports and finds what its transport has that the configuration no longer needs: the
subscriptions or bindings of the service's own queue to the topics or exchanges of messages it stopped handling.
It only reports them unless --apply is given. It never deletes topics, exchanges or queues, never touches other
services' queues, and never initializes or starts the bus.

Run it with deploy credentials once the new version of the service has rolled out everywhere, since the old
version still receives through them until then. To roll back, run \`bus provision\` with the old version.

A send-only bus or a scheduler is refused, and so is a bus that handles no message, unless --allow-empty is given.

The module's default export, or the one named by --export, is loaded as for \`bus provision\`: a bus
configuration, a bus that's built but not initialized, or a function that returns one.

Options:
      --export <name>  The export to use (default: default)
      --apply          Remove what's found, after printing it
      --allow-empty    Prune a bus that handles no message, removing every subscription or binding of its queue
      --check          Remove nothing, and exit with 3 if anything would be removed. Use it in CI
      --json           Print a JSON report (see https://node-ts.github.io/bus/guide/provisioning#pruning)
  -h, --help           Show this help

Exit codes: 0 on success, 1 if the module can't be loaded or pruning is refused or fails, 2 for invalid options,
and 3 with --check when something would be removed.`

/**
 * The exit code of `bus prune --check` when it finds something to remove
 */
export const PRUNE_CHECK_FAILED = 3

const parseOptions = (args: string[]) =>
  parseArgs({
    args,
    options: {
      export: { type: 'string', default: 'default' },
      apply: { type: 'boolean', default: false },
      'allow-empty': { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    },
    allowPositionals: true,
    strict: true
  })

/**
 * Describes an error for the command's output
 */
const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const toReport = (plans: PruningPlan[], applied: boolean): PruneReport => ({
  formatVersion: 1,
  applied,
  adapters: plans.map(({ adapter, resources, removed }) => ({
    adapter,
    resources,
    removed
  }))
})

const hasResources = (plans: PruningPlan[]): boolean =>
  plans.some(({ resources }) => resources.length > 0)

/**
 * Finds what the bus no longer needs and, with `apply`, prints it before removing it, then disposes the bus whether
 * that succeeded or not. A failure to dispose it is only reported as a warning, so it neither fails a prune that
 * succeeded nor hides why one failed.
 */
const prune = async (
  bus: BusInstance,
  options: { apply: boolean; allowEmpty: boolean },
  beforeRemoving: (plans: PruningPlan[]) => void,
  output: CommandOutput
): Promise<PruningPlan[]> => {
  try {
    const found = await bus.prune({
      apply: false,
      allowEmpty: options.allowEmpty
    })
    if (!options.apply || !hasResources(found)) {
      return found
    }
    beforeRemoving(found)
    return await bus.prune({ apply: true, allowEmpty: options.allowEmpty })
  } finally {
    try {
      await bus.dispose()
    } catch (disposeError) {
      output.error(
        `Warning: the bus could not be disposed: ${describeError(disposeError)}`
      )
    }
  }
}

/**
 * Runs `bus prune`
 * @param args the arguments after the command name
 * @param output where to write messages
 * @param cwd the directory the module path is resolved against
 * @param load how to import the module
 * @returns the process exit code
 */
export const runPrune = async (
  args: string[],
  output: CommandOutput,
  cwd: string = process.cwd(),
  load: ImportModule = importModule
): Promise<number> => {
  let parsed: ReturnType<typeof parseOptions>
  try {
    parsed = parseOptions(args)
  } catch (error) {
    output.error(`${(error as Error).message}\n\n${PRUNE_USAGE}`)
    return 2
  }
  const { values, positionals } = parsed
  if (values.help) {
    output.log(PRUNE_USAGE)
    return 0
  }
  if (positionals.length !== 1) {
    output.error(
      `${positionals.length ? 'Pass only one module' : 'Pass the module that exports the bus configuration'}\n\n${PRUNE_USAGE}`
    )
    return 2
  }
  if (values.check && values.apply) {
    output.error(
      `--check only reports, so it can't be used with --apply\n\n${PRUNE_USAGE}`
    )
    return 2
  }
  const [modulePath] = positionals
  const apply = values.apply

  let plans: PruningPlan[]
  try {
    const loaded = await loadBusConfiguration(
      modulePath,
      values.export,
      cwd,
      load
    )
    const bus = 'build' in loaded ? loaded.build() : loaded
    if (typeof bus.prune !== 'function') {
      output.error(
        `The bus in ${modulePath} can't be pruned. Upgrade @node-ts/bus-core to a version with bus.prune().`
      )
      return 1
    }
    plans = await prune(
      bus,
      { apply, allowEmpty: values['allow-empty'] },
      found => {
        const text = formatPruneReport(toReport(found, false), modulePath, true)
        // The JSON report on stdout stays parseable
        if (values.json) {
          output.error(text)
        } else {
          output.log(`${text}\n`)
        }
      },
      output
    )
  } catch (error) {
    if (
      error instanceof BusConfigurationModuleNotLoaded ||
      error instanceof BusConfigurationNotExported
    ) {
      output.error(`${error.message}\n\n${error.help}`)
      return 1
    }
    const help = (error as { help?: unknown } | undefined)?.help
    output.error(
      `Pruning failed: ${describeError(error)}${typeof help === 'string' ? `\n\n${help}` : ''}`
    )
    return 1
  }

  const report = toReport(plans, apply)
  output.log(
    values.json
      ? JSON.stringify(report, undefined, 2)
      : formatPruneReport(report, modulePath)
  )
  return values.check && hasResources(plans) ? PRUNE_CHECK_FAILED : 0
}
