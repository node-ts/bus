import { OptionManifest } from './option-manifest'
import { installCommand, PackageManager, runScript } from './package-manager'

export interface NextStepsOptions {
  /**
   * The app's directory, relative to where create-bus-app ran, or `.` for that directory
   */
  directory: string
  projectName: string
  transport: OptionManifest
  persistence: OptionManifest
  packageManager: PackageManager
}

const shellQuote = (path: string): string =>
  /^[\w./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`

/**
 * Says what was created, and the commands that run it with the package manager that created it
 * @returns the lines to print
 */
export const formatNextSteps = ({
  directory,
  projectName,
  transport,
  persistence,
  packageManager
}: NextStepsOptions): string[] => {
  const run = (script: string) => runScript(packageManager, script)
  const steps: [string, string?][] = [
    ...(directory === '.' ? [] : [[`cd ${shellQuote(directory)}`] as [string]]),
    ['cp .env.example .env'],
    [installCommand(packageManager)],
    [
      'docker compose up -d --wait',
      `starts ${[...new Set([transport.label, persistence.label])].join(' and ')}`
    ],
    [run('build')],
    [run('provision'), 'creates the queues and tables'],
    [run('start')]
  ]
  const width = Math.max(...steps.map(([command]) => command.length))
  return [
    '',
    `Created ${projectName}, with the ${transport.label} transport and ${persistence.label} persistence.`,
    '',
    'Next steps:',
    ...steps.map(([command, comment]) =>
      comment ? `  ${command.padEnd(width)}  # ${comment}` : `  ${command}`
    ),
    '',
    `Run the tests with \`${run('test')}\` and, with the services up, \`${run('test:integration')}\`.`,
    `Run it all in containers with \`docker compose --profile app up --build\`.`,
    ...(['yarn', 'bun'].includes(packageManager.name)
      ? [
          'The Dockerfile installs with npm, so run `npm install` first to create package-lock.json.'
        ]
      : []),
    'README.md has the rest.'
  ]
}
