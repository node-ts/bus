import { PackageVersionNotFound } from './error'
import { OptionManifest, TemplateOptions } from './option-manifest'
import { PackageManager } from './package-manager'

/**
 * The parts of the template's package.json that the app's is made from
 */
export interface TemplatePackageJson {
  type: string
  engines: Record<string, string>
  scripts: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

export interface BuildPackageJsonOptions {
  /**
   * The app's package name
   */
  projectName: string
  /**
   * The template's package.json
   */
  template: TemplatePackageJson
  /**
   * Every option the template offers
   */
  options: TemplateOptions
  /**
   * The options chosen
   */
  chosen: OptionManifest[]
  /**
   * The version of each @node-ts package, which `workspace:` dependencies become a `^` range of
   */
  versions: Record<string, string>
  /**
   * The package manager that created the app
   */
  packageManager: PackageManager
  /**
   * Dependency specs that replace the ranges of these packages, and override them in the whole tree
   */
  overrides?: Record<string, string>
}

const WORKSPACE_PROTOCOL = 'workspace:'

const sortKeys = (record: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
  )

/**
 * Builds the app's package.json. The template depends on what every option needs, so it keeps the dependencies that
 * no option lists, and those that the chosen options list.
 * @returns the package.json, as an object
 * @throws PackageVersionNotFound if a `workspace:` dependency's version isn't in `versions`
 */
export const buildPackageJson = ({
  projectName,
  template,
  options,
  chosen,
  versions,
  packageManager,
  overrides = {}
}: BuildPackageJsonOptions): Record<string, unknown> => {
  const optional = new Set(
    Object.values(options)
      .flat()
      .flatMap(option => option.dependencies)
  )
  const needed = new Set(chosen.flatMap(option => option.dependencies))

  const resolve = (dependencies: Record<string, string>) =>
    sortKeys(
      Object.fromEntries(
        Object.entries(dependencies)
          .filter(([name]) => !optional.has(name) || needed.has(name))
          .map(([name, range]) => {
            if (overrides[name]) {
              return [name, overrides[name]]
            }
            if (!range.startsWith(WORKSPACE_PROTOCOL)) {
              return [name, range]
            }
            const version = versions[name]
            if (!version) {
              throw new PackageVersionNotFound(name)
            }
            return [name, `^${version}`]
          })
      )
    )

  return {
    name: projectName,
    version: '0.1.0',
    private: true,
    type: template.type,
    engines: template.engines,
    // Lets corepack install the same pnpm, as Dockerfile does
    ...(packageManager.name === 'pnpm' && packageManager.version
      ? { packageManager: `pnpm@${packageManager.version}` }
      : {}),
    scripts: template.scripts,
    dependencies: resolve(template.dependencies),
    devDependencies: resolve(template.devDependencies),
    ...(Object.keys(overrides).length ? { overrides: sortKeys(overrides) } : {})
  }
}
