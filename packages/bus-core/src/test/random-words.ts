const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'

const randomWord = (): string =>
  Array.from(
    { length: 3 + Math.floor(Math.random() * 6) },
    () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  ).join('')

/**
 * Returns a space separated string of random lowercase words, for test data that only needs to vary between runs
 * @param count How many words to generate
 * @default count 3
 * @returns The words joined by single spaces
 */
export const randomWords = (count = 3): string =>
  Array.from({ length: count }, randomWord).join(' ')
