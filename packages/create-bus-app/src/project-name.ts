import { InvalidProjectName } from './error'

/**
 * Longest project name, so that queue names made from it, such as `<name>-integration-test-dead-letter`, fit in the
 * 80 characters SQS allows
 */
export const MAX_PROJECT_NAME_LENGTH = 50

/**
 * Makes a project name from the name of the directory the app is created in. It's the package's name and the queue's,
 * so it's kept to lowercase letters, digits, `-` and `_`, which every transport accepts.
 * @param directoryName the directory's name, such as `My Service`
 * @returns the project name, such as `my-service`
 * @throws InvalidProjectName if nothing usable is left, or it's too long
 */
export const toProjectName = (directoryName: string): string => {
  const name = directoryName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
  if (!name) {
    throw new InvalidProjectName(directoryName, 'it has no letters or digits')
  }
  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    throw new InvalidProjectName(
      directoryName,
      `it's longer than ${MAX_PROJECT_NAME_LENGTH} characters`
    )
  }
  return name
}
