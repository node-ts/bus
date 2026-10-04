/**
 * The writable form of a recording context, whose flags only its own functions change. Internal: it isn't exported
 * from the package.
 */
export type Writable<TContext> = {
  -readonly [K in keyof TContext]: TContext[K]
}
