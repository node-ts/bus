import type { BusConfiguration, BusInstance } from '@node-ts/bus-core'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  BusConfigurationModuleNotLoaded,
  BusConfigurationNotExported
} from './error'

/**
 * Imports a module by its file URL
 */
export type ImportModule = (url: string) => Promise<Record<string, unknown>>

/**
 * Imports a module with Node's own `import()`, so it can be ESM or CommonJS
 */
export const importModule: ImportModule = async url =>
  (await import(url)) as Record<string, unknown>

/**
 * Whether a value is a bus configuration, from whichever copy of @node-ts/bus-core the module uses, so it's
 * recognised by its shape rather than with `instanceof`
 */
const isBusConfiguration = (value: unknown): value is BusConfiguration =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { build?: unknown }).build === 'function'

/**
 * Whether a value is a built bus, from whichever copy of @node-ts/bus-core the module uses, recognised by its shape.
 * Checked after `isBusConfiguration`, since a configuration has no `provision`.
 */
const isBusInstance = (value: unknown): value is BusInstance =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { provision?: unknown }).provision === 'function'

/**
 * Describes what a value is, for an error
 */
const describeValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    return String(value)
  }
  if (typeof value === 'object') {
    return `an object with keys ${Object.keys(value).join(', ') || '(none)'}`
  }
  return `a ${typeof value}`
}

/**
 * Loads the bus a module exports: a `BusConfiguration`, or a function, sync or async, that returns one. It can also
 * be a bus that's been built but not initialized, or a function that returns one, for a bus built by a framework,
 * such as `createBusForProvisioning()` from @node-ts/bus-nestjs.
 * @param modulePath the module's path, relative to `cwd`
 * @param exportName the export to read, such as `default`
 * @param cwd the directory the path is resolved against
 * @param load how to import the module
 * @returns the configuration, not built yet, or the built bus
 * @throws BusConfigurationModuleNotLoaded if the module can't be imported
 * @throws BusConfigurationNotExported if the export isn't a configuration or a bus, or a function that returns one
 */
export const loadBusConfiguration = async (
  modulePath: string,
  exportName: string,
  cwd: string,
  load: ImportModule = importModule
): Promise<BusConfiguration | BusInstance> => {
  let module: Record<string, unknown>
  try {
    module = await load(pathToFileURL(resolve(cwd, modulePath)).href)
  } catch (error) {
    throw new BusConfigurationModuleNotLoaded(modulePath, error)
  }

  let exported = module[exportName]
  const commonJsExports = module.default
  // Importing a CommonJS module gives its exports as the default export
  if (
    exported === undefined &&
    exportName !== 'default' &&
    typeof commonJsExports === 'object' &&
    commonJsExports !== null
  ) {
    exported = (commonJsExports as Record<string, unknown>)[exportName]
  }

  const configuration: unknown =
    typeof exported === 'function'
      ? await (exported as () => unknown)()
      : exported
  if (!isBusConfiguration(configuration) && !isBusInstance(configuration)) {
    throw new BusConfigurationNotExported(
      modulePath,
      exportName,
      typeof exported === 'function'
        ? `a function that returns ${describeValue(configuration)}`
        : describeValue(configuration)
    )
  }
  return configuration
}
