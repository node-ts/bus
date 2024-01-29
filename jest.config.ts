import type { Config } from 'jest'

const config: Config = {
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
  transform: {
    '^.+\\.tsx?$': [
      'esbuild-jest',
      {
        sourcemap: true,
        loaders: {
          '.spec.ts': 'tsx',
          '.integration.ts': 'tsx'
        }
      }
    ]
  },
  testEnvironment: 'node',
  testPathIgnorePatterns: ['node_modules/', 'dist/', 'bus-test/']
}

export default config
