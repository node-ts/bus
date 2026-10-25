import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { CliIo, processIo } from './cli-io'
import { createApp, findTarballs } from './create-app'
import { DirectoryNotEmpty, OptionNotFound } from './error'
import { formatNextSteps } from './next-steps'
import {
  defaultOption,
  OPTION_KINDS,
  OptionKind,
  OptionManifest,
  readOptionManifests,
  TemplateOptions
} from './option-manifest'
import { detectPackageManager } from './package-manager'
import { toProjectName } from './project-name'
import { promptOption, promptText } from './prompt'

/**
 * The directory the app is created in when none is given
 */
export const DEFAULT_DIRECTORY = 'bus-app'

/**
 * Where the published package keeps the template, and the versions of the packages it was released with
 */
const TEMPLATE_DIRECTORY = join(__dirname, '..', 'template')
const VERSIONS_FILE = join(__dirname, 'versions.json')

/**
 * Packed packages to depend on instead of the published ones. Undocumented: CI uses it to test apps before their
 * packages are published.
 */
const TARBALLS_VARIABLE = 'CREATE_BUS_APP_TARBALLS'

/**
 * What the command line runs with, so tests can change it
 */
export interface CliContext {
  /**
   * The directory a relative directory argument is resolved against
   */
  cwd: string
  /**
   * The environment variables
   */
  env: NodeJS.ProcessEnv
  /**
   * The template's directory
   */
  templateDirectory: string
  /**
   * The version of each @node-ts package
   */
  readVersions: () => Record<string, string>
}

const defaultContext = (): CliContext => ({
  cwd: process.cwd(),
  env: process.env,
  templateDirectory: TEMPLATE_DIRECTORY,
  readVersions: () =>
    JSON.parse(readFileSync(VERSIONS_FILE, 'utf8')) as Record<string, string>
})

const formatUsage = (options: TemplateOptions): string => {
  const describe = (kind: OptionKind) =>
    options[kind].map(
      option =>
        `  ${option.name.padEnd(10)} ${option.label}: ${option.description}`
    )
  return [
    'Usage: npm create @node-ts/bus-app [directory] -- [options]',
    '',
    'Creates a TypeScript service on @node-ts/bus in a new directory, with a transport, persistence,',
    `tests, docker compose and a Dockerfile. The directory is ${DEFAULT_DIRECTORY} unless one is given.`,
    '',
    'Options:',
    `  -t, --transport <name>    The transport (default: ${defaultOption(options.transport).name})`,
    `  -p, --persistence <name>  The persistence (default: ${defaultOption(options.persistence).name})`,
    "  -y, --yes                 Ask nothing, and take the defaults for what isn't given",
    '  -h, --help                Show this help',
    '',
    'Transports:',
    ...describe('transport'),
    '',
    'Persistence:',
    ...describe('persistence'),
    '',
    "Without --yes, it asks for what isn't given when it runs in a terminal."
  ].join('\n')
}

const parseOptions = (args: string[]) =>
  parseArgs({
    args,
    options: {
      transport: { type: 'string', short: 't' },
      persistence: { type: 'string', short: 'p' },
      yes: { type: 'boolean', short: 'y', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    },
    allowPositionals: true,
    strict: true
  })

const findOption = (
  options: TemplateOptions,
  kind: OptionKind,
  name: string | undefined
): OptionManifest | undefined => {
  if (name === undefined) {
    return undefined
  }
  const found = options[kind].find(option => option.name === name)
  if (!found) {
    throw new OptionNotFound(
      `--${kind}`,
      name,
      options[kind].map(option => option.name)
    )
  }
  return found
}

const isUsable = (directory: string): boolean =>
  !existsSync(directory) ||
  (statSync(directory).isDirectory() && readdirSync(directory).length === 0)

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    const help = (error as { help?: unknown }).help
    return typeof help === 'string'
      ? `${error.message}\n${help}`
      : error.message
  }
  return String(error)
}

/**
 * Runs `npm create @node-ts/bus-app`
 * @param args the arguments after the command
 * @param io where to write, and ask questions
 * @param context the directory and environment it runs in, and where its template is
 * @returns the process exit code: 0 once the app is created, 1 if it fails, and 2 for a usage error
 */
export const runCli = async (
  args: string[],
  io: CliIo = processIo(),
  context: CliContext = defaultContext()
): Promise<number> => {
  const options = readOptionManifests(context.templateDirectory)
  let parsed: ReturnType<typeof parseOptions>
  try {
    parsed = parseOptions(args)
    if (parsed.positionals.length > 1) {
      throw new Error(
        `Give one directory, not ${parsed.positionals.length}: ${parsed.positionals.join(' ')}`
      )
    }
  } catch (error) {
    io.error(`${describeError(error)}\n\n${formatUsage(options)}`)
    return 2
  }
  const { values, positionals } = parsed
  if (values.help) {
    io.log(formatUsage(options))
    return 0
  }

  try {
    const given = Object.fromEntries(
      OPTION_KINDS.map(kind => [kind, findOption(options, kind, values[kind])])
    ) as Record<OptionKind, OptionManifest | undefined>
    const interactive = !values.yes && io.isInteractive

    const directoryArgument =
      positionals[0] ??
      (interactive
        ? await promptText(io, 'Where should the app go?', DEFAULT_DIRECTORY)
        : DEFAULT_DIRECTORY)
    const directory = resolve(context.cwd, directoryArgument)
    if (!isUsable(directory)) {
      throw new DirectoryNotEmpty(directoryArgument)
    }
    const projectName = toProjectName(basename(directory))

    const choose = async (kind: OptionKind, question: string) =>
      given[kind] ??
      (interactive
        ? await promptOption(
            io,
            question,
            options[kind],
            defaultOption(options[kind])
          )
        : defaultOption(options[kind]))
    const transport = await choose(
      'transport',
      'Which transport should it send and receive messages with?'
    )
    const persistence = await choose(
      'persistence',
      'Where should it keep workflow state and the outbox?'
    )

    const versions = context.readVersions()
    const tarballFolder = context.env[TARBALLS_VARIABLE]
    const packageManager = detectPackageManager(
      context.env.npm_config_user_agent
    )
    createApp({
      directory,
      projectName,
      templateDirectory: context.templateDirectory,
      options,
      transport,
      persistence,
      versions,
      packageManager,
      tarballs: tarballFolder
        ? findTarballs(resolve(context.cwd, tarballFolder), versions)
        : undefined
    })

    for (const line of formatNextSteps({
      directory: relative(context.cwd, directory) || '.',
      projectName,
      transport,
      persistence,
      packageManager
    })) {
      io.log(line)
    }
    return 0
  } catch (error) {
    io.error(describeError(error))
    return error instanceof OptionNotFound ? 2 : 1
  } finally {
    io.close()
  }
}
