/**
 * This raises transpile time errors any time the tokenizer hits this function in the code
 */
export function assertUnreachable(unexpectedValue: never): never {
  throw new Error(`Unexepected code path - ${unexpectedValue}`)
}
