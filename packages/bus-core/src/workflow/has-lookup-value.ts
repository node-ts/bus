/**
 * Whether the value a `MessageWorkflowMapping` `lookup` returned can find workflow state. `undefined`,
 * `null` and `''` can't: a message without a value belongs to no workflow instance, not to every instance whose
 * mapped field is missing or empty. `null` isn't in the lookup's type, but can come from a message field that's
 * null once deserialized. Persistence adapters use it to return no state from `getWorkflowState` without querying.
 * @param value the value the lookup returned
 * @returns `true` unless the value is `undefined`, `null` or `''`
 * @example
 * const lookupValue = messageMap.lookup(message, attributes)
 * if (!hasLookupValue(lookupValue)) {
 *   return []
 * }
 */
export const hasLookupValue = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== ''
