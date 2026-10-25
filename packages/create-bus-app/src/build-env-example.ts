import { OptionManifest } from './option-manifest'

/**
 * Builds the app's .env.example, with the variables of the chosen options set for the services in compose.yaml
 * @param chosen the options chosen
 * @returns the file's content
 */
export const buildEnvExample = (chosen: OptionManifest[]): string => {
  const written = new Set<string>()
  const sections = chosen.flatMap(option => {
    const variables = option.env.filter(({ name }) => !written.has(name))
    if (!variables.length) {
      return []
    }
    variables.forEach(({ name }) => written.add(name))
    return [
      [
        `# ${option.label} ${option.kind}`,
        ...variables.flatMap(({ name, local, comment }) => [
          ...(comment ? [`# ${comment}`] : []),
          `${name}=${local}`
        ])
      ].join('\n')
    ]
  })
  return [
    [
      '# The settings for running the app, `bus provision` and the tests on your',
      '# machine, against the services in compose.yaml. Copy it to .env, which',
      '# src/env.ts loads. Variables that are already set win over .env.'
    ].join('\n'),
    ...sections
  ]
    .map(section => `${section}\n`)
    .join('\n')
}
