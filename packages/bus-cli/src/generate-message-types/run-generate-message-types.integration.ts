import { JsonSerializer } from '@node-ts/bus-core'
import { MessageTypes } from '@node-ts/bus-messages'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import * as ts from 'typescript'
import { runCli } from '../cli'
import { CommandOutput } from './run-generate-message-types'

const SUPPORTED = join(__dirname, '..', '..', 'test', 'supported')
// Inside the package, so the generated file can resolve @node-ts/bus-messages
const TMP_DIRECTORY = join(__dirname, '..', '..', 'tmp')

const OUT_FILE = 'src/message-types.generated.ts'

// Loads the transpiled fixture at runtime
const load = createRequire(__filename)

class CapturedOutput implements CommandOutput {
  readonly lines: string[] = []

  log(message: string): void {
    this.lines.push(message)
  }

  error(message: string): void {
    this.lines.push(message)
  }
}

const run = async (
  cwd: string,
  ...args: string[]
): Promise<{ exitCode: number; output: string }> => {
  const output = new CapturedOutput()
  const exitCode = await runCli(
    ['generate-message-types', ...args],
    output,
    cwd
  )
  return { exitCode, output: output.lines.join('\n') }
}

const listSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter(fileName => fileName.endsWith('.ts'))
    .map(fileName => join(directory, fileName))

/**
 * Compiles the project the way a plain transpiler would (file by file, no type information),
 * then loads the generated file
 */
const transpileAndLoad = (project: string): MessageTypes => {
  const outDirectory = join(project, 'out')
  for (const fileName of listSourceFiles(join(project, 'src'))) {
    const { outputText } = ts.transpileModule(readFileSync(fileName, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        useDefineForClassFields: false
      },
      fileName
    })
    const outFile = join(
      outDirectory,
      relative(join(project, 'src'), fileName)
    ).replace(/\.ts$/, '.js')
    mkdirSync(dirname(outFile), { recursive: true })
    writeFileSync(outFile, outputText)
  }
  return (
    load(join(outDirectory, 'message-types.generated.js')) as {
      messageTypes: MessageTypes
    }
  ).messageTypes
}

const typeCheck = (project: string): string[] => {
  const configFile = join(project, 'tsconfig.json')
  const parsed = ts.getParsedCommandLineOfConfigFile(configFile, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => undefined
  })!
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  return ts
    .getPreEmitDiagnostics(program)
    .map(diagnostic =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    )
}

describe('runGenerateMessageTypes', () => {
  let project: string

  beforeAll(() => {
    mkdirSync(TMP_DIRECTORY, { recursive: true })
    project = mkdtempSync(join(TMP_DIRECTORY, 'supported-'))
    cpSync(SUPPORTED, project, { recursive: true })
  })

  afterAll(() => {
    rmSync(project, { recursive: true, force: true })
  })

  describe('when checking before the file has been generated', () => {
    let result: { exitCode: number; output: string }

    beforeAll(async () => {
      result = await run(project, '--check')
    })

    it('should fail and report the file is missing', () => {
      expect(result.exitCode).toEqual(1)
      expect(result.output).toContain(`${OUT_FILE} is missing`)
    })
  })

  describe('when generating the file', () => {
    let result: { exitCode: number; output: string }
    let diagnostics: string[]
    let messageTypes: MessageTypes

    beforeAll(async () => {
      result = await run(project)
      diagnostics = typeCheck(project)
      messageTypes = transpileAndLoad(project)
    })

    it('should write it', () => {
      expect(result.exitCode).toEqual(0)
      expect(result.output).toEqual(`Wrote 4 message types to ${OUT_FILE}`)
    })

    it('should type check with the project', () => {
      expect(diagnostics).toEqual([])
    })

    describe('and using it to round trip a message', () => {
      let sent: any
      let received: any

      beforeAll(() => {
        const out = join(project, 'out')
        const { PlaceOrder, Line } = load(join(out, 'place-order.js'))
        const { Address } = load(join(out, 'address.js'))
        const { GeoPoint } = load(join(out, 'geo-point.js'))
        const { TreeNode } = load(join(out, 'tree-node.js'))

        const location = Object.assign(new GeoPoint(), {
          latitude: 1,
          surveyedAt: new Date(1)
        })
        const line = Object.assign(new Line(), {
          sku: 'a',
          addedAt: new Date(2)
        })
        const root = Object.assign(new TreeNode(), {
          name: 'root',
          createdAt: new Date(3),
          children: []
        })
        root.children.push(
          Object.assign(new TreeNode(), {
            name: 'leaf',
            createdAt: new Date(4),
            children: []
          })
        )
        sent = Object.assign(new PlaceOrder(), {
          placedAt: new Date(5),
          shipTo: Object.assign(new Address(), { street: 's', location }),
          lines: [line],
          nested: [[new Date(6)]],
          byId: new Map([['a', line]]),
          counts: new Map([[1, 2]]),
          dates: new Set([new Date(7)]),
          total: 10n ** 30n,
          lookup: { k: new Date(8) },
          meta: { seenAt: new Date(9), note: 'n' },
          tree: root
        })

        const serializer = new JsonSerializer(messageTypes)
        received = serializer.deserialize(
          serializer.serialize(sent),
          PlaceOrder
        )
        received.classes = { PlaceOrder, Line, Address, GeoPoint, TreeNode }
      })

      it('should restore the message, its nested classes and built-in types', () => {
        const { PlaceOrder, Line, Address, GeoPoint, TreeNode } =
          received.classes
        expect(received).toBeInstanceOf(PlaceOrder)
        expect(received.lineCount).toEqual(1)
        expect(received.placedAt).toEqual(new Date(5))
        expect(received.shipTo).toBeInstanceOf(Address)
        expect(received.shipTo.location).toBeInstanceOf(GeoPoint)
        expect(received.shipTo.location.label).toEqual('1')
        expect(received.lines[0]).toBeInstanceOf(Line)
        expect(received.nested[0][0]).toEqual(new Date(6))
        expect(received.byId.get('a')).toBeInstanceOf(Line)
        expect(received.counts).toEqual(new Map([[1, 2]]))
        expect(received.dates).toEqual(new Set([new Date(7)]))
        expect(received.total).toEqual(10n ** 30n)
        expect(received.lookup.k).toEqual(new Date(8))
        expect(received.meta.seenAt).toEqual(new Date(9))
        expect(received.tree.children[0]).toBeInstanceOf(TreeNode)
        expect(received.tree.children[0].createdAt).toEqual(new Date(4))
      })
    })
  })

  describe('when checking a file that a formatter has changed', () => {
    let result: { exitCode: number; output: string }
    let regenerated: { exitCode: number; output: string }
    let reformatted: string

    beforeAll(async () => {
      const outFile = join(project, OUT_FILE)
      const lines = readFileSync(outFile, 'utf8').split('\n')
      const imports = lines.filter(line => line.startsWith('import {'))
      // Reverse the imports, swap the quotes and add semicolons
      reformatted = [
        lines[0],
        ...imports.reverse(),
        ...lines.filter(
          line => !line.startsWith('import {') && line !== lines[0]
        )
      ]
        .join('\n')
        .replace(/'/g, '"')
        .replace(/\n\}\n$/, '\n};\n')
      writeFileSync(outFile, reformatted)
      result = await run(project, '--check')
      regenerated = await run(project)
    })

    it('should pass', () => {
      expect(result.exitCode).toEqual(0)
      expect(result.output).toEqual(`${OUT_FILE} is up to date`)
    })

    it('should leave the file alone when regenerating', () => {
      expect(regenerated.output).toEqual(`${OUT_FILE} is up to date`)
      expect(readFileSync(join(project, OUT_FILE), 'utf8')).toEqual(reformatted)
    })
  })

  describe('when checking after a message changes', () => {
    let result: { exitCode: number; output: string }

    beforeAll(async () => {
      const messageFile = join(project, 'src', 'literal-names.ts')
      writeFileSync(
        messageFile,
        readFileSync(messageFile, 'utf8').replace(
          "readonly $name = 'fixture/ping'\n",
          "readonly $name = 'fixture/ping'\n  pingedAt: Date\n"
        )
      )
      result = await run(project, '--check')
    })

    it('should fail and report the file is out of date', () => {
      expect(result.exitCode).toEqual(1)
      expect(result.output).toContain(`${OUT_FILE} is out of date`)
    })
  })

  describe('when a message has an unsupported type', () => {
    let result: { exitCode: number; output: string }

    beforeAll(async () => {
      writeFileSync(
        join(project, 'src', 'bad.ts'),
        "export class Bad {\n  $name = 'fixture/bad'\n  callback: () => void\n}\n"
      )
      result = await run(project)
      rmSync(join(project, 'src', 'bad.ts'))
    })

    it('should fail and list the problem', () => {
      expect(result.exitCode).toEqual(1)
      expect(result.output).toContain(
        "Bad.callback: functions can't be sent as JSON"
      )
    })
  })

  describe('when given an unknown option', () => {
    let result: { exitCode: number; output: string }

    beforeAll(async () => {
      result = await run(project, '--nope')
    })

    it('should fail with the usage', () => {
      expect(result.exitCode).toEqual(2)
      expect(result.output).toContain('Usage: bus generate-message-types')
    })
  })
})
