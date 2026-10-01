import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, matchesGlob, relative, resolve } from 'node:path'
import type * as TS from 'typescript'
import { MessageTypeGenerationFailed } from './error'
import { GenerateMessageTypesOptions } from './generate-message-types-options'
import { loadTypeScript } from './load-type-script'
import { MessageTypeReader } from './message-type-reader'
import { ImportExtension, writeMessageTypes } from './message-types-writer'

/**
 * The output of `generateMessageTypes`
 */
export interface GeneratedMessageTypes {
  /**
   * The absolute path of the file to write
   */
  outFile: string

  /**
   * The TypeScript source of the file
   */
  content: string

  /**
   * The number of messages and workflow states in the file
   */
  messageCount: number

  /**
   * Type errors in the project that didn't stop generation, such as strictness checks
   */
  warnings: string[]
}

/**
 * The default path of the generated file
 */
export const DEFAULT_MESSAGE_TYPES_FILE = 'src/message-types.generated.ts'

/**
 * Stands in for the generated file while the project is read. Code that imports the generated file
 * then still type checks on the first run, before the file exists, or while it's out of date.
 */
const OUT_FILE_STUB = `export const messageTypes: any = { messages: {}, types: {} }\n`

const toPosix = (path: string): string => path.split('\\').join('/')

/**
 * Imports need the `.js` extension when TypeScript resolves modules the way Node.js does
 */
const resolveImportExtension = (
  ts: typeof TS,
  options: TS.CompilerOptions
): ImportExtension => {
  const { module, moduleResolution } = options
  const isNodeResolution =
    moduleResolution === undefined
      ? module !== undefined &&
        module >= ts.ModuleKind.Node16 &&
        module <= ts.ModuleKind.NodeNext
      : moduleResolution === ts.ModuleResolutionKind.Node16 ||
        moduleResolution === ts.ModuleResolutionKind.NodeNext
  return isNodeResolution ? 'js' : 'none'
}

/**
 * Finds the package the project belongs to, whose name prefixes every type key so two message
 * libraries can be registered together
 */
const findPackage = (
  directory: string
): { root: string; name: string | undefined } => {
  for (let current = directory; ; current = dirname(current)) {
    const manifest = join(current, 'package.json')
    if (existsSync(manifest)) {
      const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as {
        name?: string
      }
      return { root: current, name }
    }
    if (dirname(current) === current) {
      return { root: directory, name: undefined }
    }
  }
}

/**
 * Reads the messages and workflow state declared in a TypeScript project, and generates the source
 * of a file that maps each `$name` to how its fields are restored from JSON. Pass the exported
 * `messageTypes` to `Bus.configure().withMessageTypes()`. The project is only read, like
 * `tsc --noEmit`, with the project's own copy of TypeScript, and nothing is written.
 * @param options where the project is and which files to read
 * @returns the generated source, where to write it, and warnings about the project
 * @throws TypeScriptNotFound if the project doesn't have TypeScript installed
 * @throws MessageTypeGenerationFailed if the project can't be read, or a message has a type that
 * can't be restored from JSON
 * @example
 * const { outFile, content } = generateMessageTypes({ entry: ['src/messages/**\/*.ts'] })
 * writeFileSync(outFile, content)
 */
export const generateMessageTypes = (
  options: GenerateMessageTypesOptions = {}
): GeneratedMessageTypes => {
  const cwd = resolve(options.cwd ?? process.cwd())
  const ts = loadTypeScript(cwd)
  const configFile = resolve(cwd, options.project ?? 'tsconfig.json')
  const outFile = resolve(cwd, options.out ?? DEFAULT_MESSAGE_TYPES_FILE)
  const entry = options.entry ?? []
  const exclude = options.exclude ?? []
  const formatDiagnostic = (diagnostic: TS.Diagnostic): string =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')

  const configProblems: string[] = []
  const parsed = ts.getParsedCommandLineOfConfigFile(configFile, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic =>
      configProblems.push(formatDiagnostic(diagnostic))
  })
  if (!parsed || configProblems.length) {
    throw new MessageTypeGenerationFailed(
      configProblems.length
        ? configProblems
        : [`${configFile} could not be read`]
    )
  }
  const parseErrors = parsed.errors.filter(
    diagnostic => diagnostic.category === ts.DiagnosticCategory.Error
  )
  if (parseErrors.length) {
    throw new MessageTypeGenerationFailed(parseErrors.map(formatDiagnostic))
  }

  const compilerOptions = { ...parsed.options, noEmit: true }
  const host = ts.createCompilerHost(compilerOptions)
  const isOutFile = (fileName: string) => resolve(fileName) === outFile
  const { fileExists, readFile, getSourceFile } = host
  host.fileExists = fileName => isOutFile(fileName) || fileExists(fileName)
  host.readFile = fileName =>
    isOutFile(fileName) ? OUT_FILE_STUB : readFile(fileName)
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    isOutFile(fileName)
      ? ts.createSourceFile(fileName, OUT_FILE_STUB, languageVersion)
      : getSourceFile(fileName, languageVersion, ...rest)

  const rootNames = parsed.fileNames.filter(fileName => !isOutFile(fileName))
  const program = ts.createProgram({
    rootNames,
    options: compilerOptions,
    projectReferences: parsed.projectReferences,
    host
  })

  const isEntry = (fileName: string): boolean => {
    const path = toPosix(relative(cwd, fileName))
    return (
      (!entry.length || entry.some(glob => matchesGlob(path, glob))) &&
      !exclude.some(glob => matchesGlob(path, glob))
    )
  }
  const rootFiles = new Set(rootNames.map(fileName => resolve(fileName)))
  const entryFiles = program
    .getSourceFiles()
    .filter(
      sourceFile =>
        !sourceFile.isDeclarationFile &&
        rootFiles.has(resolve(sourceFile.fileName)) &&
        isEntry(sourceFile.fileName)
    )
    .sort((a, b) => (a.fileName < b.fileName ? -1 : 1))
  if (!entryFiles.length) {
    throw new MessageTypeGenerationFailed([
      `No files in ${toPosix(relative(cwd, configFile))} match the entry globs (${entry.join(', ') || 'every file'})`
    ])
  }

  const packageInfo = findPackage(dirname(configFile))
  const { model, problems, warnings } = new MessageTypeReader({
    ts,
    program,
    cwd,
    keyRoot: packageInfo.root,
    keyPrefix: packageInfo.name ? `${packageInfo.name}/` : ''
  }).read(entryFiles)
  if (problems.length) {
    throw new MessageTypeGenerationFailed(problems)
  }

  return {
    outFile,
    content: writeMessageTypes(
      model,
      outFile,
      resolveImportExtension(ts, parsed.options)
    ),
    messageCount: model.messages.length,
    warnings
  }
}
