/**
 * Maps items with an async function, running at most `concurrency` at once, keeping their order
 * @param items the items to map
 * @param concurrency the most calls to run at once
 * @param map the async function to map each item with
 * @returns the results, in the order of `items`
 */
export const mapWithConcurrency = async <TItem, TResult>(
  items: TItem[],
  concurrency: number,
  map: (item: TItem) => Promise<TResult>
): Promise<TResult[]> => {
  const results: TResult[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await map(items[index])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  )
  return results
}
