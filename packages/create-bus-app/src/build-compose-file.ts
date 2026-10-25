import { OptionManifest } from './option-manifest'

const quote = (value: string): string => JSON.stringify(value)

/**
 * The compose files of the services the chosen options need, without repeats
 * @param chosen the options chosen
 */
export const composeFilesOf = (chosen: OptionManifest[]): string[] => [
  ...new Set(chosen.flatMap(option => Object.values(option.services)))
]

/**
 * The environment variables of the chosen options, by name, without repeats
 * @param chosen the options chosen
 * @param place where they're used: on the developer's machine or in docker compose
 */
export const environmentOf = (
  chosen: OptionManifest[],
  place: 'local' | 'compose'
): Map<string, string> =>
  new Map(
    chosen
      .flatMap(option => option.env)
      .map(variable => [
        variable.name,
        place === 'compose'
          ? (variable.compose ?? variable.local)
          : variable.local
      ])
  )

/**
 * Builds the app's compose.yaml. It includes each service's own compose file, so that they stay as they are in the
 * template and Renovate updates their images, and adds the `provision` and `app` services, in the `app` profile.
 * @param chosen the options chosen
 * @returns the file's content
 */
export const buildComposeFile = (chosen: OptionManifest[]): string => {
  const services = [
    ...new Set(chosen.flatMap(option => Object.keys(option.services)))
  ]
  const environment = [...environmentOf(chosen, 'compose')]
  return [
    '# `docker compose up -d --wait` starts the services the app uses, for running',
    '# it and its tests on your machine. `docker compose --profile app up --build`',
    '# also creates their queues and tables, then runs the app in a container.',
    'include:',
    ...composeFilesOf(chosen).map(file => `  - ${file}`),
    '',
    'x-environment: &environment',
    ...environment.map(([name, value]) => `  ${name}: ${quote(value)}`),
    '',
    'services:',
    '  # Creates the queues and tables the app needs with `bus provision`, then',
    '  # exits. It runs in the build stage, which has the dev dependencies.',
    '  provision:',
    '    profiles: [app]',
    '    build:',
    '      context: .',
    '      target: build',
    '    command: [node_modules/.bin/bus, provision, dist/bus-configuration.js]',
    '    environment: *environment',
    '    depends_on:',
    ...services.flatMap(service => [
      `      ${service}:`,
      '        condition: service_healthy'
    ]),
    '',
    '  app:',
    '    profiles: [app]',
    '    build: .',
    '    environment: *environment',
    '    depends_on:',
    '      provision:',
    '        condition: service_completed_successfully',
    '    restart: unless-stopped',
    ''
  ].join('\n')
}
