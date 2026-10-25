import { CliIo } from './cli-io'
import { OptionManifest } from './option-manifest'

/**
 * Asks for some text
 * @param io where to ask
 * @param question what to ask
 * @param defaultAnswer the answer when nothing is typed
 */
export const promptText = async (
  io: CliIo,
  question: string,
  defaultAnswer: string
): Promise<string> =>
  (await io.ask(`${question} (${defaultAnswer}): `)).trim() || defaultAnswer

/**
 * Asks for one of a list of options by its number, until a number in the list, or nothing for the default, is typed
 * @param io where to ask
 * @param question what to ask
 * @param options the options, in the order they're numbered
 * @param defaultOption the option chosen when nothing is typed
 */
export const promptOption = async (
  io: CliIo,
  question: string,
  options: OptionManifest[],
  defaultOption: OptionManifest
): Promise<OptionManifest> => {
  io.log(question)
  options.forEach((option, index) =>
    io.log(
      `  ${index + 1}. ${option.label}: ${option.description}${option === defaultOption ? ' (default)' : ''}`
    )
  )
  const defaultNumber = options.indexOf(defaultOption) + 1
  for (;;) {
    const answer = (
      await io.ask(`Choose 1-${options.length} (${defaultNumber}): `)
    ).trim()
    if (!answer) {
      return defaultOption
    }
    const chosen = /^\d+$/.test(answer)
      ? options[Number(answer) - 1]
      : undefined
    if (chosen) {
      return chosen
    }
    io.log(`Type a number from 1 to ${options.length}.`)
  }
}
