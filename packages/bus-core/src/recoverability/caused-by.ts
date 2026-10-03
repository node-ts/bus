/**
 * A class of error, such as `TypeError` or one of your own
 */
export type ErrorType = abstract new (...args: any[]) => Error

/**
 * How deep `causedBy` looks through nested errors, which guards against a cycle of causes
 */
const MAX_ERROR_DEPTH = 10

/**
 * Checks whether an error, or any error inside it, is an instance of one of the given types. It looks through the
 * `rejections` of a `HandlerDispatchRejected` (the error thrown when handlers fail), the errors of an
 * `AggregateError`, and each error's `cause`, which is where a `WorkflowHandlerFailed` keeps the workflow handler's
 * error.
 * @param error the error to check, such as `MessageHandlingFailure.error`
 * @param errorTypes the classes of error to look for
 * @returns true if any error found is an instance of one of `errorTypes`
 * @example
 * const policy: RecoverabilityPolicy = failure =>
 *   causedBy(failure.error, [ValidationError]) ? deadLetter() : retry(1_000)
 */
export const causedBy = (error: unknown, errorTypes: ErrorType[]): boolean => {
  const visit = (candidate: unknown, depth: number): boolean => {
    if (depth > MAX_ERROR_DEPTH || !(candidate instanceof Error)) {
      return false
    }
    if (errorTypes.some(errorType => candidate instanceof errorType)) {
      return true
    }
    const nested: unknown[] = [candidate.cause]
    const { rejections } = candidate as { rejections?: unknown }
    if (Array.isArray(rejections)) {
      nested.push(...(rejections as unknown[]))
    }
    if (candidate instanceof AggregateError) {
      nested.push(...(candidate.errors as unknown[]))
    }
    return nested.some(inner => visit(inner, depth + 1))
  }
  return visit(error, 0)
}
