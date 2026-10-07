/**
 * Options for `@BusHandler()` and `@BusWorkflow()`
 */
export interface BusRegistrationOptions {
  /**
   * The name of the bus, as given to `BusModule.forRoot({ name })`, to register the class with
   * @default 'default'
   */
  bus?: string
}
