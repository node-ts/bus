import {
  detectPackageManager,
  installCommand,
  runScript
} from './package-manager'

describe('detectPackageManager', () => {
  describe('when pnpm ran it', () => {
    it('should return pnpm and its version', () => {
      expect(
        detectPackageManager('pnpm/12.4.1 npm/? node/v24.11.1 linux x64')
      ).toEqual({ name: 'pnpm', version: '12.4.1' })
    })
  })

  describe('when npm ran it', () => {
    it('should return npm', () => {
      expect(
        detectPackageManager(
          'npm/11.6.2 node/v24.11.1 linux x64 workspaces/false'
        )
      ).toEqual({ name: 'npm', version: '11.6.2' })
    })
  })

  describe('without a user agent', () => {
    it('should return npm', () => {
      expect(detectPackageManager(undefined)).toEqual({ name: 'npm' })
    })
  })

  describe('with an unknown user agent', () => {
    it('should return npm', () => {
      expect(detectPackageManager('deno/2.5.0')).toEqual({ name: 'npm' })
    })
  })
})

describe('runScript', () => {
  it('should run scripts with npm run, except start and test', () => {
    expect(runScript({ name: 'npm' }, 'provision')).toEqual('npm run provision')
    expect(runScript({ name: 'npm' }, 'start')).toEqual('npm start')
  })

  it('should run scripts by name with pnpm and yarn', () => {
    expect(runScript({ name: 'pnpm' }, 'provision')).toEqual('pnpm provision')
    expect(runScript({ name: 'yarn' }, 'build')).toEqual('yarn build')
  })

  it('should run scripts with bun run', () => {
    expect(runScript({ name: 'bun' }, 'start')).toEqual('bun run start')
  })
})

describe('installCommand', () => {
  it('should install with each package manager', () => {
    expect(installCommand({ name: 'npm' })).toEqual('npm install')
    expect(installCommand({ name: 'pnpm' })).toEqual('pnpm install')
    expect(installCommand({ name: 'yarn' })).toEqual('yarn')
    expect(installCommand({ name: 'bun' })).toEqual('bun install')
  })
})
