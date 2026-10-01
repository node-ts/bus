/**
 * Options for generating message types. Relative paths and globs are resolved against `cwd`.
 */
export interface GenerateMessageTypesOptions {
  /**
   * The tsconfig.json of the project that declares the messages
   * @default 'tsconfig.json'
   */
  project?: string

  /**
   * Globs of the files to read messages and workflow state from. Every exported, non-abstract class
   * with a `$name` in these files is included. Files the tsconfig doesn't include, such as test
   * fixtures, are read too.
   * @default every file in the project
   */
  entry?: string[]

  /**
   * Globs of files to leave out, even if they match `entry`
   * @default []
   */
  exclude?: string[]

  /**
   * The file to generate
   * @default 'src/message-types.generated.ts'
   */
  out?: string

  /**
   * The directory relative paths and globs are resolved against
   * @default process.cwd()
   */
  cwd?: string
}
