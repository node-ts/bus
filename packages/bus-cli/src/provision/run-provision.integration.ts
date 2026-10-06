import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ProvisionReport } from './provision-report'

const PACKAGE_DIRECTORY = join(__dirname, '..', '..')
const BIN = join(PACKAGE_DIRECTORY, 'bus.mjs')

/**
 * Runs the built `bus` command in a process of its own, as a deploy pipeline would
 */
const runBus = async (
  ...args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  try {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [BIN, ...args],
      { cwd: PACKAGE_DIRECTORY }
    )
    return { exitCode: 0, stdout, stderr }
  } catch (error) {
    const { code, stdout, stderr } = error as {
      code: number
      stdout: string
      stderr: string
    }
    return { exitCode: code, stdout, stderr }
  }
}

jest.setTimeout(30_000)

describe('bus provision', () => {
  describe('when given a TypeScript module that exports a bus configuration', () => {
    let exitCode: number
    let report: ProvisionReport

    beforeAll(async () => {
      const result = await runBus(
        'provision',
        'test/provision/bus.ts',
        '--dry-run',
        '--json',
        '--permissions'
      )
      exitCode = result.exitCode
      report = JSON.parse(result.stdout) as ProvisionReport
    })

    it('should succeed', () => {
      expect(exitCode).toEqual(0)
    })

    it('should print the plan of its transport', () => {
      expect(report).toEqual({
        formatVersion: 1,
        dryRun: true,
        adapters: [
          {
            adapter: 'ProvisionedQueue',
            resources: [{ type: 'topic', name: 'fixture/order-placed' }],
            runtimePermissions: { format: 'list', document: ['publish'] }
          }
        ]
      })
    })
  })

  describe('when given a named export that is an async function', () => {
    let exitCode: number
    let stdout: string

    beforeAll(async () => {
      ;({ exitCode, stdout } = await runBus(
        'provision',
        'test/provision/bus.ts',
        '--export',
        'createBusConfiguration'
      ))
    })

    it('should provision the bus it returns', () => {
      expect(exitCode).toEqual(0)
      expect(stdout).toContain('Provisioned the bus in test/provision/bus.ts.')
      expect(stdout).toContain('topic  fixture/order-placed')
    })
  })

  describe('when the export is not a bus configuration', () => {
    let exitCode: number
    let stderr: string

    beforeAll(async () => {
      ;({ exitCode, stderr } = await runBus(
        'provision',
        'test/provision/bus.ts',
        '--export',
        'notABus'
      ))
    })

    it('should fail, saying what to export', () => {
      expect(exitCode).toEqual(1)
      expect(stderr).toContain(
        "The notABus export of test/provision/bus.ts isn't a bus configuration"
      )
    })
  })
})
