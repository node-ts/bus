import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

/**
 * What an option is chosen for
 */
export type OptionKind = 'transport' | 'persistence'

export const OPTION_KINDS: OptionKind[] = ['transport', 'persistence']

/**
 * An environment variable an option is configured with
 */
export interface EnvironmentVariable {
  /**
   * The variable's name, such as `DATABASE_URL`
   */
  name: string
  /**
   * Its value on the developer's machine, written to .env.example
   */
  local: string
  /**
   * Its value in the containers docker compose runs, when it differs from `local`
   */
  compose?: string
  /**
   * A comment written above it in .env.example
   */
  comment?: string
}

/**
 * Describes a transport or persistence the template offers. Each is a JSON file in the template's `options/<kind>`
 * folder, next to the code in `src/<kind>/<name>.ts` that the scaffolder copies to `src/<kind>.ts`.
 */
export interface OptionManifest {
  /**
   * The option's name, given with `--transport` or `--persistence`. It's the manifest's file name.
   */
  name: string
  /**
   * Whether it's a transport or a persistence
   */
  kind: OptionKind
  /**
   * The name shown to people, such as `RabbitMQ`
   */
  label: string
  /**
   * A few words on what it is, shown in the prompts and the help
   */
  description: string
  /**
   * Where it's listed among the options of its kind, from 1
   */
  order: number
  /**
   * Whether it's chosen when no other is
   */
  default?: boolean
  /**
   * The template's dependencies that only this option, or others that list them too, needs
   */
  dependencies: string[]
  /**
   * The docker compose services it needs, by service name, with the template's compose file that defines each
   */
  services: Record<string, string>
  /**
   * The environment variables it's configured with
   */
  env: EnvironmentVariable[]
}

/**
 * The options the template offers, of each kind
 */
export type TemplateOptions = Record<OptionKind, OptionManifest[]>

/**
 * Reads the option manifests in a template
 * @param templateDirectory the template's directory
 * @returns the options of each kind, in their order
 */
export const readOptionManifests = (
  templateDirectory: string
): TemplateOptions => {
  const read = (kind: OptionKind): OptionManifest[] => {
    const directory = join(templateDirectory, 'options', kind)
    return readdirSync(directory)
      .filter(file => file.endsWith('.json'))
      .map(file => ({
        ...(JSON.parse(readFileSync(join(directory, file), 'utf8')) as Omit<
          OptionManifest,
          'name' | 'kind'
        >),
        name: basename(file, '.json'),
        kind
      }))
      .sort((a, b) => a.order - b.order)
  }
  return { transport: read('transport'), persistence: read('persistence') }
}

/**
 * The option of a kind that's chosen when no other is
 * @param options the options of one kind
 */
export const defaultOption = (options: OptionManifest[]): OptionManifest =>
  options.find(option => option.default) ?? options[0]
