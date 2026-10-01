import {
  existsSync,
  mkdirSync,
  readFileSync,
  watch,
  writeFileSync
} from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { MessageTypeGenerationFailed } from './error'
import {
  DEFAULT_MESSAGE_TYPES_FILE,
  generateMessageTypes
} from './generate-message-types'
import { GenerateMessageTypesOptions } from './generate-message-types-options'
import { isSameMessageTypes } from './is-same-message-types'

/**
 * Where the command writes its output, so tests can capture it
 */
export interface CommandOutput {
  log(message: string): void
  error(message: string): void
}

const WATCH_DEBOUNCE_MS = 100
const SOURCE_FILE = /\.[mc]?tsx?$/

export const GENERATE_MESSAGE_TYPES_USAGE = `Usage: bus generate-message-types [options]

Reads the messages and workflow state in a TypeScript project and generates a file that maps each
$name to how its fields are restored from JSON. Pass its messageTypes export to
Bus.configure().withMessageTypes().

Options:
  -p, --project <path>  The project's tsconfig.json (default: tsconfig.json)
  -e, --entry <glob>    Files to read messages from. Repeat for more globs (default: every file in the project)
  -x, --exclude <glob>  Files to leave out. Repeat for more globs
  -o, --out <path>      The file to generate (default: ${DEFAULT_MESSAGE_TYPES_FILE})
      --check           Don't write anything. Fail if the file is missing or out of date, e.g. in CI
      --watch           Regenerate the file whenever a source file in the project changes
  -h, --help            Show this help`

const parseOptions = (args: string[]) =>
  parseArgs({
    args,
    options: {
      project: { type: 'string', short: 'p' },
      entry: { type: 'string', short: 'e', multiple: true },
      exclude: { type: 'string', short: 'x', multiple: true },
      out: { type: 'string', short: 'o' },
      check: { type: 'boolean', default: false },
      watch: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    },
    allowPositionals: false,
    strict: true
  }).values

/**
 * Generates the file, or checks it, and reports the outcome
 * @returns the process exit code
 */
const generate = (
  options: GenerateMessageTypesOptions,
  check: boolean,
  output: CommandOutput
): number => {
  try {
    const { outFile, content, messageCount } = generateMessageTypes(options)
    const displayPath = relative(options.cwd!, outFile)
    const existing = existsSync(outFile)
      ? readFileSync(outFile, 'utf8')
      : undefined
    const isUpToDate =
      existing !== undefined && isSameMessageTypes(existing, content)

    if (check) {
      if (isUpToDate) {
        output.log(`${displayPath} is up to date`)
        return 0
      }
      output.error(
        `${displayPath} is ${existing === undefined ? 'missing' : 'out of date'}. Run \`bus generate-message-types\` to update it`
      )
      return 1
    }

    // An up to date file isn't rewritten, so a formatter's changes to it are kept
    if (isUpToDate) {
      output.log(`${displayPath} is up to date`)
      return 0
    }
    mkdirSync(dirname(outFile), { recursive: true })
    writeFileSync(outFile, content)
    output.log(`Wrote ${messageCount} message types to ${displayPath}`)
    return 0
  } catch (error) {
    if (error instanceof MessageTypeGenerationFailed) {
      output.error(error.message)
      return 1
    }
    throw error
  }
}

const watchProject = (
  options: GenerateMessageTypesOptions,
  output: CommandOutput
): Promise<number> => {
  const projectDirectory = dirname(
    resolve(options.cwd!, options.project ?? 'tsconfig.json')
  )
  const outFile = resolve(
    options.cwd!,
    options.out ?? DEFAULT_MESSAGE_TYPES_FILE
  )
  let timer: NodeJS.Timeout | undefined

  generate(options, false, output)
  output.log('Watching for changes...')

  return new Promise<number>(() => {
    watch(projectDirectory, { recursive: true }, (_, fileName) => {
      if (!fileName || !SOURCE_FILE.test(fileName)) {
        return
      }
      const changedFile = resolve(projectDirectory, fileName)
      if (changedFile === outFile || changedFile.includes('node_modules')) {
        return
      }
      clearTimeout(timer)
      timer = setTimeout(
        () => generate(options, false, output),
        WATCH_DEBOUNCE_MS
      )
    })
  })
}

/**
 * Runs `bus generate-message-types`
 * @param args the arguments after the command name
 * @param output where to write messages
 * @param cwd the directory paths are resolved against
 * @returns the process exit code. With `--watch` it doesn't resolve, and the process runs until it's stopped.
 */
export const runGenerateMessageTypes = async (
  args: string[],
  output: CommandOutput,
  cwd: string = process.cwd()
): Promise<number> => {
  let values: ReturnType<typeof parseOptions>
  try {
    values = parseOptions(args)
  } catch (error) {
    output.error(
      `${(error as Error).message}\n\n${GENERATE_MESSAGE_TYPES_USAGE}`
    )
    return 2
  }
  if (values.help) {
    output.log(GENERATE_MESSAGE_TYPES_USAGE)
    return 0
  }
  if (values.check && values.watch) {
    output.error('--check and --watch can not be used together')
    return 2
  }

  const options: GenerateMessageTypesOptions = {
    cwd,
    project: values.project,
    entry: values.entry,
    exclude: values.exclude,
    out: values.out
  }
  return values.watch
    ? watchProject(options, output)
    : generate(options, values.check, output)
}
