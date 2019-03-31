export async function sleep (timeoutMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeoutMs))
}
