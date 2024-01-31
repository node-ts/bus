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
  testPathIgnorePatterns: ['node_modules/', 'dist/', 'bus-test/'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json'
      }
    ]
  }
}

export default config
