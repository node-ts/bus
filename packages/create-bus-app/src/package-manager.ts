/**
 * A package manager that can run `npm create`
 */
export type PackageManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun'

/**
 * The package manager that ran create-bus-app
 */
export interface PackageManager {
  name: PackageManagerName
  /**
   * Its version, when it's known
   */
  version?: string
}

const PACKAGE_MANAGERS: PackageManagerName[] = ['npm', 'pnpm', 'yarn', 'bun']

/**
 * Finds the package manager that ran create-bus-app from the user agent it sets, such as
 * `pnpm/12.4.1 npm/? node/v24.11.1 linux x64`
 * @param userAgent the `npm_config_user_agent` environment variable
 * @returns the package manager, or npm when it isn't known
 */
export const detectPackageManager = (
  userAgent: string | undefined
): PackageManager => {
  const [name, version] = (userAgent ?? '').split(' ')[0].split('/')
  const known = PACKAGE_MANAGERS.find(manager => manager === name)
  return known ? { name: known, version } : { name: 'npm' }
}

/**
 * The command that runs a package.json script with a package manager
 * @param packageManager the package manager
 * @param script the script's name
 */
export const runScript = ({ name }: PackageManager, script: string): string => {
  if (name === 'npm') {
    return ['start', 'test'].includes(script)
      ? `npm ${script}`
      : `npm run ${script}`
  }
  return name === 'bun' ? `bun run ${script}` : `${name} ${script}`
}

/**
 * The command that installs dependencies with a package manager
 * @param packageManager the package manager
 */
export const installCommand = ({ name }: PackageManager): string =>
  name === 'yarn' ? 'yarn' : `${name} install`
