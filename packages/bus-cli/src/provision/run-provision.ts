import type { BusInstance } from '@node-ts/bus-core'
import { parseArgs } from 'node:util'
import { CommandOutput } from '../generate-message-types/run-generate-message-types'
import {
  BusConfigurationModuleNotLoaded,
  BusConfigurationNotExported
} from './error'
import { formatProvisionReport } from './format-provision-report'
import {
  ImportModule,
  importModule,
  loadBusConfiguration
} from './load-bus-configuration'
import { ProvisionReport } from './provision-report'

export const PROVISION_USAGE = `Usage: bus provision <module> [options]

Builds the bus a module exports and creates everything it needs on its transport and persistence, such as
queues, topics, subscriptions, exchanges, tables and indexes. It's idempotent, so run it on every deploy, with
deploy credentials, before the service starts. It never initializes or starts the bus.

The module's default export, or the one named by --export, is a bus configuration (Bus.configure()...,
not built), or a function, sync or async, that returns one. It's loaded with import(), so it can be JavaScript,
or TypeScript that Node can run by stripping its types.

Options:
      --export <name>  The export to use (default: default)
      --dry-run        Print what would be provisioned, without connecting to anything or changing anything
      --permissions    Also print the permissions each adapter needs at runtime, such as an IAM policy
      --json           Print a JSON report (see https://node-ts.github.io/bus/guide/provisioning)
  -h, --help           Show this help`

const parseOptions = (args: string[]) =>
  parseArgs({
    args,
    options: {
      export: { type: 'string', default: 'default' },
      'dry-run': { type: 'boolean', default: false },
      permissions: { type: 'boolean', default: false },
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

/**
 * Provisions the bus, then disposes it whether provisioning succeeded or not. A failure to dispose it is only
 * reported as a warning, so it neither fails a provisioning that succeeded nor hides why one failed.
 */
const provision = async (
  bus: BusInstance,
  dryRun: boolean,
  output: CommandOutput
): Promise<Awaited<ReturnType<BusInstance['provision']>>> => {
  try {
    return await bus.provision({ dryRun })
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
 * Runs `bus provision`
 * @param args the arguments after the command name
 * @param output where to write messages
 * @param cwd the directory the module path is resolved against
 * @param load how to import the module
 * @returns the process exit code
 */
export const runProvision = async (
  args: string[],
  output: CommandOutput,
  cwd: string = process.cwd(),
  load: ImportModule = importModule
): Promise<number> => {
  let parsed: ReturnType<typeof parseOptions>
  try {
    parsed = parseOptions(args)
  } catch (error) {
    output.error(`${(error as Error).message}\n\n${PROVISION_USAGE}`)
    return 2
  }
  const { values, positionals } = parsed
  if (values.help) {
    output.log(PROVISION_USAGE)
    return 0
  }
  if (positionals.length !== 1) {
    output.error(
      `${positionals.length ? 'Pass only one module' : 'Pass the module that exports the bus configuration'}\n\n${PROVISION_USAGE}`
    )
    return 2
  }
  const [modulePath] = positionals
  const dryRun = values['dry-run']

  let plans: Awaited<ReturnType<BusInstance['provision']>>
  try {
    const configuration = await loadBusConfiguration(
      modulePath,
      values.export,
      cwd,
      load
    )
    const bus = configuration.build()
    if (typeof bus.provision !== 'function') {
      output.error(
        `The bus in ${modulePath} can't be provisioned. Upgrade @node-ts/bus-core to a version with bus.provision().`
      )
      return 1
    }
    plans = await provision(bus, dryRun, output)
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
      `Provisioning failed: ${describeError(error)}${typeof help === 'string' ? `\n\n${help}` : ''}`
    )
    return 1
  }

  const report: ProvisionReport = {
    formatVersion: 1,
    dryRun,
    adapters: plans.map(({ adapter, resources, runtimePermissions }) => ({
      adapter,
      resources,
      ...(values.permissions && runtimePermissions
        ? { runtimePermissions }
        : {})
    }))
  }
  output.log(
    values.json
      ? JSON.stringify(report, undefined, 2)
      : formatProvisionReport(report, modulePath, values.permissions)
  )
  return 0
}
