/**
 * Returns a random non-negative integer, for test data that only needs to vary between runs
 * @param max The exclusive upper bound
 * @default max Number.MAX_SAFE_INTEGER
 * @returns An integer in the range [0, max)
 */
export const randomInt = (max = Number.MAX_SAFE_INTEGER): number =>
  Math.floor(Math.random() * max)
