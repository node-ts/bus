import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from './create-app'
import { readOptionManifests } from './option-manifest'
import { TEMPLATE_DIRECTORY, TEST_VERSIONS } from './test'

jest.setTimeout(120_000)

const options = readOptionManifests(TEMPLATE_DIRECTORY)
const combinations = options.transport.flatMap(transport =>
  options.persistence.map(persistence => ({ transport, persistence }))
)

// Type checks every app the template can create, with the template's own dependencies, and checks that the message
// types it was created with are the ones the generator makes for it. CI installs, builds and tests some of them for
// real.
describe('createApp', () => {
  describe.each(combinations)(
    'when the $transport.name transport and $persistence.name persistence are chosen',
    ({ transport, persistence }) => {
      let directory: string
      const run = (command: string, args: string[]) => {
        try {
          return execFileSync(
            join(directory, 'node_modules', '.bin', command),
            args,
            { cwd: directory, encoding: 'utf8', stdio: 'pipe' }
          )
        } catch (error) {
          const { stdout, stderr } = error as { stdout: string; stderr: string }
          throw new Error(
            `${command} ${args.join(' ')} failed:\n${stdout}${stderr}`,
            { cause: error }
          )
        }
      }

      beforeAll(() => {
        directory = join(
          mkdtempSync(join(tmpdir(), 'create-bus-app-')),
          `library-${transport.name}-${persistence.name}`
        )
        createApp({
          directory,
          projectName: `library-${transport.name}-${persistence.name}`,
          templateDirectory: TEMPLATE_DIRECTORY,
          options,
          transport,
          persistence,
          versions: TEST_VERSIONS,
          packageManager: { name: 'npm' }
        })
        symlinkSync(
          join(TEMPLATE_DIRECTORY, 'node_modules'),
          join(directory, 'node_modules'),
          'dir'
        )
      })

      afterAll(() => {
        rmSync(join(directory, '..'), { recursive: true, force: true })
      })

      it('should type check', () => {
        expect(() => run('tsc', ['--noEmit'])).not.toThrow()
      })

      it('should have up to date message types', () => {
        expect(run('bus', ['generate-message-types', '--check'])).toContain(
          'is up to date'
        )
      })
    }
  )
})
