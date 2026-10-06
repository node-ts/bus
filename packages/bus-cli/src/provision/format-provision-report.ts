import { ProvisionReport } from './provision-report'

/**
 * Writes a report as a plan people can read: each adapter's resources, and with `permissions`, what each needs at
 * runtime
 * @param report what was provisioned
 * @param modulePath the module the bus came from
 * @param permissions whether to include the runtime permissions
 * @returns the text to print
 */
export const formatProvisionReport = (
  report: ProvisionReport,
  modulePath: string,
  permissions: boolean
): string => {
  if (report.adapters.length === 0) {
    return `The bus in ${modulePath} has nothing to provision. Its transport and persistence don't implement provision().`
  }

  const lines = [
    report.dryRun
      ? `Plan for the bus in ${modulePath}. Nothing was changed.`
      : `Provisioned the bus in ${modulePath}.`
  ]
  for (const { adapter, resources, runtimePermissions } of report.adapters) {
    lines.push(
      '',
      `${adapter} (${resources.length} ${resources.length === 1 ? 'resource' : 'resources'})`
    )
    const typeWidth = Math.max(...resources.map(({ type }) => type.length))
    for (const { type, name } of resources) {
      lines.push(`  ${type.padEnd(typeWidth)}  ${name}`)
    }
    if (permissions && runtimePermissions) {
      lines.push(
        '',
        `  Runtime permissions (${runtimePermissions.format}):`,
        ...formatDocument(runtimePermissions.document).map(
          line => `    ${line}`
        )
      )
    }
  }
  return lines.join('\n')
}

/**
 * A list of statements, such as SQL grants, is written a line each, and anything else as indented JSON
 */
const formatDocument = (document: unknown): string[] =>
  Array.isArray(document) &&
  document.every(statement => typeof statement === 'string')
    ? (document as string[])
    : JSON.stringify(document, undefined, 2).split('\n')
