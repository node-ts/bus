import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { buildComposeFile, composeFilesOf } from './build-compose-file'
import { buildEnvExample } from './build-env-example'
import { buildPackageJson, TemplatePackageJson } from './build-package-json'
import { OptionManifest, TemplateOptions } from './option-manifest'
import { PackageManager } from './package-manager'

/**
 * The template's package name. Every occurrence of it in the template, such as in message names and the generated
 * message types, is replaced with the project's name.
 */
export const TEMPLATE_NAME = 'create-bus-app-template'

/**
 * Files that npm leaves out of packages are stored under another name in the template
 */
const RENAMED: Record<string, string> = {
  _gitignore: '.gitignore',
  _dockerignore: '.dockerignore'
}

/**
 * Template paths that aren't copied as they are: build output, the option manifests and the files of every option,
 * of which only the chosen ones are copied, and package.json, which is built
 */
const isCopiedAsIs = (path: string): boolean =>
  ![
    'node_modules',
    'dist',
    'options',
    'package.json',
    'tsconfig.tsbuildinfo',
    'Dockerfile',
    'Dockerfile.pnpm',
    'src/transport',
    'src/transport.ts',
    'src/persistence',
    'src/persistence.ts'
  ].includes(path) && !/^compose\..+\.yaml$/.test(path)

export interface CreateAppOptions {
  /**
   * The directory to create the app in, which must be empty or not exist
   */
  directory: string
  /**
   * The app's package and queue name
   */
  projectName: string
  /**
   * The template's directory
   */
  templateDirectory: string
  /**
   * Every option the template offers
   */
  options: TemplateOptions
  /**
   * The transport chosen
   */
  transport: OptionManifest
  /**
   * The persistence chosen
   */
  persistence: OptionManifest
  /**
   * The version of each @node-ts package, which `workspace:` dependencies become a `^` range of
   */
  versions: Record<string, string>
  /**
   * The package manager that's creating the app
   */
  packageManager: PackageManager
  /**
   * Packed @node-ts packages to depend on instead of the published ones, by package name, with each tarball's path.
   * They're copied into the app's `tarballs` folder. Only CI uses it, to test apps before their packages are
   * published.
   */
  tarballs?: Map<string, string>
}

/**
 * Creates an app from the template, with the chosen transport and persistence
 * @param options what to create, and where
 */
export const createApp = ({
  directory,
  projectName,
  templateDirectory,
  options,
  transport,
  persistence,
  versions,
  packageManager,
  tarballs = new Map()
}: CreateAppOptions): void => {
  const chosen = [transport, persistence]
  const read = (path: string) =>
    readFileSync(join(templateDirectory, path), 'utf8').replaceAll(
      TEMPLATE_NAME,
      projectName
    )
  const write = (path: string, content: string) => {
    const target = join(directory, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }

  const copyDirectory = (path: string) => {
    for (const entry of readdirSync(join(templateDirectory, path), {
      withFileTypes: true
    })) {
      const entryPath = path ? `${path}/${entry.name}` : entry.name
      if (!isCopiedAsIs(entryPath)) {
        continue
      }
      if (entry.isDirectory()) {
        copyDirectory(entryPath)
      } else {
        const target = path
          ? `${path}/${entry.name}`
          : (RENAMED[entry.name] ?? entry.name)
        write(target, read(entryPath))
      }
    }
  }

  mkdirSync(directory, { recursive: true })
  copyDirectory('')
  write('src/transport.ts', read(`src/transport/${transport.name}.ts`))
  write('src/persistence.ts', read(`src/persistence/${persistence.name}.ts`))
  write(
    'Dockerfile',
    read(packageManager.name === 'pnpm' ? 'Dockerfile.pnpm' : 'Dockerfile')
  )
  for (const file of composeFilesOf(chosen)) {
    write(file, read(file))
  }
  write('compose.yaml', buildComposeFile(chosen))
  write('.env.example', buildEnvExample(chosen))

  const overrides = copyTarballs(directory, tarballs)
  const template = JSON.parse(
    readFileSync(join(templateDirectory, 'package.json'), 'utf8')
  ) as TemplatePackageJson
  const packageJson = buildPackageJson({
    projectName,
    template,
    options,
    chosen,
    versions,
    packageManager,
    overrides
  })
  write('package.json', `${JSON.stringify(packageJson, null, 2)}\n`)
  if (Object.keys(overrides).length) {
    // pnpm reads overrides from its workspace file rather than package.json
    write(
      'pnpm-workspace.yaml',
      [
        'overrides:',
        ...Object.entries(overrides).map(
          ([name, spec]) => `  '${name}': ${spec}`
        ),
        ''
      ].join('\n')
    )
  }
}

/**
 * Copies packed packages into the app
 * @returns the dependency spec of each package, relative to the app
 */
const copyTarballs = (
  directory: string,
  tarballs: Map<string, string>
): Record<string, string> => {
  const overrides: Record<string, string> = {}
  for (const [name, path] of tarballs) {
    const target = join(directory, 'tarballs', path.split(/[/\\]/).pop()!)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(path, target)
    overrides[name] =
      `file:${relative(directory, target).replaceAll('\\', '/')}`
  }
  return overrides
}

/**
 * Finds the packed @node-ts packages in a folder, as `pnpm pack` names them, such as `node-ts-bus-core-1.3.3.tgz`
 * @param folder the folder
 * @param versions the version of each package to find
 * @returns the path of each tarball found, by package name
 */
export const findTarballs = (
  folder: string,
  versions: Record<string, string>
): Map<string, string> =>
  new Map(
    Object.entries(versions).flatMap(([name, version]) => {
      const path = join(
        folder,
        `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`
      )
      return existsSync(path) ? [[name, path] as const] : []
    })
  )
