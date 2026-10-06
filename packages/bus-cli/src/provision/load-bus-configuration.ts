import type { BusConfiguration } from '@node-ts/bus-core'
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
 * Loads the bus configuration a module exports: a `BusConfiguration`, or a function, sync or async, that returns
 * one
 * @param modulePath the module's path, relative to `cwd`
 * @param exportName the export to read, such as `default`
 * @param cwd the directory the path is resolved against
 * @param load how to import the module
 * @returns the configuration, not built yet
 * @throws BusConfigurationModuleNotLoaded if the module can't be imported
 * @throws BusConfigurationNotExported if the export isn't a configuration, or a function that returns one
 */
export const loadBusConfiguration = async (
  modulePath: string,
  exportName: string,
  cwd: string,
  load: ImportModule = importModule
): Promise<BusConfiguration> => {
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
  if (!isBusConfiguration(configuration)) {
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
