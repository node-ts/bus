import { ProvisionReportResource } from '../provision'
import { PruneReport, PruneReportAdapter } from './prune-report'

type ResourceList = 'resources' | 'removed' | 'failed' | 'notFound'

const count = (report: PruneReport, list: ResourceList): number =>
  report.adapters.reduce((total, adapter) => total + adapter[list].length, 0)

const describeCount = (count: number): string =>
  `${count} ${count === 1 ? 'resource' : 'resources'}`

/**
 * Lines of a table of resources, each with its type, name and an optional status or note, padded to line up
 */
const formatRows = (
  rows: { status?: string; resource: ProvisionReportResource; note?: string }[]
): string[] => {
  const statusWidth = Math.max(...rows.map(({ status }) => status?.length ?? 0))
  const typeWidth = Math.max(
    ...rows.map(({ resource }) => resource.type.length)
  )
  return rows.map(
    ({ status, resource, note }) =>
      `  ${[
        ...(statusWidth ? [(status ?? '').padEnd(statusWidth)] : []),
        resource.type.padEnd(typeWidth),
        `${resource.name}${note ? `: ${note}` : ''}`
      ].join('  ')}`
  )
}

/**
 * The rows of what one transport did with `--apply`: what it removed, failed to remove, and no longer found
 */
const appliedRows = (adapter: PruneReportAdapter) => [
  ...adapter.removed.map(resource => ({ status: 'removed', resource })),
  ...adapter.failed.map(({ resource, error }) => ({
    status: 'failed',
    resource,
    note: error
  })),
  ...adapter.notFound.map(resource => ({ status: 'not found', resource }))
]

/**
 * The first line of the report of a run with `--apply`
 */
const describeApplied = (report: PruneReport, modulePath: string): string => {
  const removed = count(report, 'removed')
  const failed = count(report, 'failed')
  const notFound = count(report, 'notFound')
  const lines = [
    failed
      ? `Removed ${removed} of ${describeCount(removed + failed)} the bus in ${modulePath} no longer needs. ${failed} could not be removed, and ${failed === 1 ? 'is' : 'are'} left as ${failed === 1 ? 'it was' : 'they were'}.`
      : `Removed ${describeCount(removed)} the bus in ${modulePath} no longer needs.`
  ]
  if (notFound) {
    lines.push(
      `${describeCount(notFound)} printed before removing ${notFound === 1 ? 'was' : 'were'} no longer found, so ${notFound === 1 ? 'it was' : 'they were'} left as ${notFound === 1 ? 'it is' : 'they are'}.`
    )
  }
  return lines.join(' ')
}

/**
 * Writes a report people can read: what each transport found that the bus no longer needs, and with `--apply`, what
 * was removed, what failed and what was no longer found
 * @param report what was found
 * @param modulePath the module the bus came from
 * @param removing whether it's printed before what it lists is removed
 * @returns the text to print
 */
export const formatPruneReport = (
  report: PruneReport,
  modulePath: string,
  removing = false
): string => {
  if (report.adapters.length === 0) {
    return `The bus in ${modulePath} has nothing to prune. Its transport doesn't implement prune().`
  }
  const found = count(report, 'resources')
  if (found === 0 && count(report, 'notFound') === 0) {
    return `Nothing to prune for the bus in ${modulePath}. Its transport has nothing its configuration no longer needs.`
  }

  if (report.applied) {
    const lines = [describeApplied(report, modulePath)]
    for (const adapter of report.adapters) {
      const rows = appliedRows(adapter)
      if (rows.length) {
        lines.push('', adapter.adapter, ...formatRows(rows))
      }
    }
    return lines.join('\n')
  }

  const lines = [
    removing
      ? `Removing ${describeCount(found)} the bus in ${modulePath} no longer needs:`
      : `Found ${describeCount(found)} the bus in ${modulePath} no longer needs. Nothing was removed: run again with --apply to remove them.`
  ]
  for (const { adapter, resources } of report.adapters) {
    if (resources.length) {
      lines.push(
        '',
        `${adapter} (${describeCount(resources.length)})`,
        ...formatRows(resources.map(resource => ({ resource })))
      )
    }
  }
  return lines.join('\n')
}
