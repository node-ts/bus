import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PruneReport } from './prune-report'

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

describe('bus prune', () => {
  describe('when given a TypeScript module that exports a bus configuration', () => {
    let exitCode: number
    let report: PruneReport

    beforeAll(async () => {
      const result = await runBus(
        'prune',
        'test/provision/prune-bus.ts',
        '--json'
      )
      exitCode = result.exitCode
      report = JSON.parse(result.stdout) as PruneReport
    })

    it('should report what its transport no longer needs', () => {
      expect(exitCode).toEqual(0)
      expect(report).toEqual({
        formatVersion: 1,
        applied: false,
        adapters: [
          {
            adapter: 'PrunedQueue',
            resources: [
              { type: 'subscription', name: 'fixture/order-cancelled' }
            ],
            removed: [],
            failed: [],
            notFound: []
          }
        ]
      })
    })
  })

  describe('when checking it', () => {
    let exitCode: number

    beforeAll(async () => {
      ;({ exitCode } = await runBus(
        'prune',
        'test/provision/prune-bus.ts',
        '--check'
      ))
    })

    it('should exit with 3, since something would be removed', () => {
      expect(exitCode).toEqual(3)
    })
  })

  describe('when applying it', () => {
    let exitCode: number
    let stdout: string

    beforeAll(async () => {
      ;({ exitCode, stdout } = await runBus(
        'prune',
        'test/provision/prune-bus.ts',
        '--apply'
      ))
    })

    it('should print what it removes, then that it removed it', () => {
      expect(exitCode).toEqual(0)
      const removing = stdout.indexOf('Removing 1 resource')
      const removed = stdout.indexOf('Removed 1 resource')
      expect(stdout).toContain('removed  subscription  fixture/order-cancelled')
      expect(removing).toBeGreaterThanOrEqual(0)
      expect(removed).toBeGreaterThan(removing)
    })
  })

  describe('when the bus is send-only', () => {
    let exitCode: number
    let stderr: string

    beforeAll(async () => {
      ;({ exitCode, stderr } = await runBus(
        'prune',
        'test/provision/prune-bus.ts',
        '--export',
        'sendOnlyBus',
        '--apply'
      ))
    })

    it('should refuse', () => {
      expect(exitCode).toEqual(1)
      expect(stderr).toContain('is send-only')
    })
  })
})
