import { buildPackageJson, TemplatePackageJson } from './build-package-json'
import { PackageVersionNotFound } from './error'
import { OptionManifest, TemplateOptions } from './option-manifest'

const option = (
  kind: OptionManifest['kind'],
  name: string,
  dependencies: string[]
): OptionManifest => ({
  name,
  kind,
  label: name,
  description: name,
  order: 1,
  dependencies,
  services: {},
  env: []
})

const postgres = option('transport', 'postgres', ['@node-ts/bus-postgres'])
const redis = option('transport', 'redis', ['@node-ts/bus-redis', 'redis'])
const postgresPersistence = option('persistence', 'postgres', [
  '@node-ts/bus-postgres'
])
const mongodb = option('persistence', 'mongodb', ['@node-ts/bus-mongodb'])
const options: TemplateOptions = {
  transport: [postgres, redis],
  persistence: [postgresPersistence, mongodb]
}

const template: TemplatePackageJson = {
  type: 'module',
  engines: { node: '>=24' },
  scripts: { build: 'tsc' },
  dependencies: {
    redis: '^6.3.0',
    '@node-ts/bus-redis': 'workspace:^',
    '@node-ts/bus-postgres': 'workspace:^',
    '@node-ts/bus-mongodb': 'workspace:^',
    '@node-ts/bus-core': 'workspace:^'
  },
  devDependencies: {
    typescript: '^6.0.3',
    '@node-ts/bus-cli': 'workspace:^'
  }
}

const versions = {
  '@node-ts/bus-cli': '2.0.0',
  '@node-ts/bus-core': '2.1.0',
  '@node-ts/bus-mongodb': '2.0.0',
  '@node-ts/bus-postgres': '2.0.2',
  '@node-ts/bus-redis': '2.0.0'
}

describe('buildPackageJson', () => {
  describe('when Redis and MongoDB are chosen', () => {
    let sut: Record<string, unknown>

    beforeAll(() => {
      sut = buildPackageJson({
        projectName: 'library',
        template,
        options,
        chosen: [redis, mongodb],
        versions,
        packageManager: { name: 'npm' }
      })
    })

    it('should keep the common dependencies and the chosen options', () => {
      expect(sut.dependencies).toEqual({
        '@node-ts/bus-core': '^2.1.0',
        '@node-ts/bus-mongodb': '^2.0.0',
        '@node-ts/bus-redis': '^2.0.0',
        redis: '^6.3.0'
      })
    })

    it('should keep every dev dependency', () => {
      expect(sut.devDependencies).toEqual({
        '@node-ts/bus-cli': '^2.0.0',
        typescript: '^6.0.3'
      })
    })

    it('should name it after the project, with the template scripts', () => {
      expect(sut).toMatchObject({
        name: 'library',
        private: true,
        type: 'module',
        engines: { node: '>=24' },
        scripts: { build: 'tsc' }
      })
    })

    it('should have no packageManager or overrides', () => {
      expect(sut).not.toHaveProperty('packageManager')
      expect(sut).not.toHaveProperty('overrides')
    })
  })

  describe('when Postgres is chosen twice', () => {
    it('should depend on it once', () => {
      const sut = buildPackageJson({
        projectName: 'library',
        template,
        options,
        chosen: [postgres, postgresPersistence],
        versions,
        packageManager: { name: 'npm' }
      })
      expect(sut.dependencies).toEqual({
        '@node-ts/bus-core': '^2.1.0',
        '@node-ts/bus-postgres': '^2.0.2'
      })
    })
  })

  describe('when pnpm created it', () => {
    it('should set packageManager, for corepack', () => {
      const sut = buildPackageJson({
        projectName: 'library',
        template,
        options,
        chosen: [postgres, postgresPersistence],
        versions,
        packageManager: { name: 'pnpm', version: '12.4.1' }
      })
      expect(sut.packageManager).toEqual('pnpm@12.4.1')
    })
  })

  describe('with overrides', () => {
    it('should use them as the dependency specs, and override them', () => {
      const overrides = {
        '@node-ts/bus-core': 'file:tarballs/node-ts-bus-core-2.1.0.tgz',
        '@node-ts/bus-messages': 'file:tarballs/node-ts-bus-messages-2.0.0.tgz'
      }
      const sut = buildPackageJson({
        projectName: 'library',
        template,
        options,
        chosen: [postgres, postgresPersistence],
        versions,
        packageManager: { name: 'npm' },
        overrides
      })
      expect(sut.dependencies).toMatchObject({
        '@node-ts/bus-core': 'file:tarballs/node-ts-bus-core-2.1.0.tgz'
      })
      expect(sut.overrides).toEqual(overrides)
    })
  })

  describe('when a workspace dependency has no version', () => {
    it('should throw PackageVersionNotFound', () => {
      expect(() =>
        buildPackageJson({
          projectName: 'library',
          template,
          options,
          chosen: [postgres, postgresPersistence],
          versions: {},
          packageManager: { name: 'npm' }
        })
      ).toThrow(PackageVersionNotFound)
    })
  })
})
