import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testTimeout: 5000,
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  collectCoverageFrom: [
    '**/*.ts',
    '!**/node_modules/**',
    '!**/vendor/**',
    '!**/dist/**',
    '!**/bus-messages/**',
    '!**/error/*'
  ],
  testRegex: '(src\\/.+\\.|/)(integration|spec)\\.ts$',
  testEnvironment: 'node',
  // Generated files import with a .js extension, which resolves to the .ts source
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testPathIgnorePatterns: ['node_modules/', 'dist/'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
        // Every package is CommonJS, so node16 module output is CJS. Keep type
        // checking tests rather than switching to isolatedModules.
        diagnostics: { ignoreCodes: [151002] }
      }
    ]
  }
}

export default config
