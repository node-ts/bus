// The ESM entry point re-exports the CommonJS build instead of being a second
// build. `import` and `require` then share one module instance, so singletons
// like messageHandlingContext and `instanceof` checks on error and message
// classes still work when an app loads this package both ways.
export * from './index.js'
