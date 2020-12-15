/**
 * Returns a promise that resolves when the timeout expires
 * @param timeoutMs How long to wait until the promise resolves
 */
export const sleep = async (timeoutMs: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, timeoutMs))
