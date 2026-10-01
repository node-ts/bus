import { matchesGlob, relative, resolve } from 'node:path'
import * as ts from 'typescript'
import { MessageTypeGenerationFailed } from './error'
import { GenerateMessageTypesOptions } from './generate-message-types-options'
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
}

/**
 * The default path of the generated file
 */
export const DEFAULT_MESSAGE_TYPES_FILE = 'src/message-types.generated.ts'

const toPosix = (path: string): string => path.split('\\').join('/')

const formatDiagnostic = (diagnostic: ts.Diagnostic): string =>
  ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')

/**
 * Imports need the `.js` extension when TypeScript resolves modules the way Node.js does
 */
const resolveImportExtension = (
  options: ts.CompilerOptions
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
 * Reads the messages and workflow state declared in a TypeScript project, and generates the source
 * of a file that maps each `$name` to how its fields are restored from JSON. Pass the exported
 * `messageTypes` to `Bus.configure().withMessageTypes()`. The project is only read, like
 * `tsc --noEmit`, and nothing is written.
 * @param options where the project is and which files to read
 * @returns the generated source and where to write it
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
  const configFile = resolve(cwd, options.project ?? 'tsconfig.json')
  const outFile = resolve(cwd, options.out ?? DEFAULT_MESSAGE_TYPES_FILE)
  const entry = options.entry ?? []
  const exclude = options.exclude ?? []

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

  // The generated file is left out, so an out-of-date copy can't stop it being regenerated
  const rootNames = parsed.fileNames.filter(
    fileName => resolve(fileName) !== outFile
  )
  const program = ts.createProgram({
    rootNames,
    options: { ...parsed.options, noEmit: true },
    projectReferences: parsed.projectReferences
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

  const { model, problems } = new MessageTypeReader(program, cwd).read(
    entryFiles
  )
  if (problems.length) {
    throw new MessageTypeGenerationFailed(problems)
  }

  return {
    outFile,
    content: writeMessageTypes(
      model,
      outFile,
      resolveImportExtension(parsed.options)
    ),
    messageCount: model.messages.length
  }
}
