// The default DebugLogger writes warnings and errors to the console, and many tests make handlers
// fail on purpose, so the test output fills with expected errors. Drop only the lines the bus's own
// loggers write (they start with an `@node-ts/` namespace). Anything else written to the console,
// such as a stray console.log or an error from a dependency, still shows. Tests that assert on
// logging inject a mock logger or `consoleOutput`, so they aren't affected.
// Set BUS_TEST_LOGS=true to see the bus log output, e.g. when debugging a failing test.
const BUS_LOG_PREFIX = '@node-ts/'

if (process.env.BUS_TEST_LOGS !== 'true') {
  for (const level of ['warn', 'error'] as const) {
    const write = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      const [first] = args
      if (typeof first === 'string' && first.startsWith(BUS_LOG_PREFIX)) {
        return
      }
      write(...args)
    }
  }
}
