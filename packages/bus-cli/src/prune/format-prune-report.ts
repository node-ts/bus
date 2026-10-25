import { PruneReport } from './prune-report'

const countResources = (report: PruneReport): number =>
  report.adapters.reduce((count, { resources }) => count + resources.length, 0)

const describeCount = (count: number): string =>
  `${count} ${count === 1 ? 'resource' : 'resources'}`

/**
 * Writes a report people can read: what each transport found that the bus no longer needs, and whether it was removed
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
  const count = countResources(report)
  if (count === 0) {
    return `Nothing to prune for the bus in ${modulePath}. Its transport has nothing its configuration no longer needs.`
  }

  const removed = report.adapters.some(adapter => adapter.removed)
  const lines = [
    removing
      ? `Removing ${describeCount(count)} the bus in ${modulePath} no longer needs:`
      : removed
        ? `Removed ${describeCount(count)} the bus in ${modulePath} no longer needs.`
        : `Found ${describeCount(count)} the bus in ${modulePath} no longer needs. Nothing was removed: run again with --apply to remove them.`
  ]
  for (const { adapter, resources } of report.adapters) {
    if (!resources.length) {
      continue
    }
    lines.push('', `${adapter} (${describeCount(resources.length)})`)
    const typeWidth = Math.max(...resources.map(({ type }) => type.length))
    for (const { type, name } of resources) {
      lines.push(`  ${type.padEnd(typeWidth)}  ${name}`)
    }
  }
  return lines.join('\n')
}
