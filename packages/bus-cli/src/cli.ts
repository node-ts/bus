import {
  CommandOutput,
  runGenerateMessageTypes
} from './generate-message-types/run-generate-message-types'

type Command = (
  args: string[],
  output: CommandOutput,
  cwd: string
) => Promise<number>

const COMMANDS: { [name: string]: Command } = {
  'generate-message-types': runGenerateMessageTypes
}

const USAGE = `Usage: bus <command> [options]

Commands:
  generate-message-types  Generate the runtime types of messages, so Dates and class instances are restored

Run \`bus <command> --help\` for a command's options.`

/**
 * Runs the `bus` command line
 * @param args the arguments after `bus`
 * @param output where to write messages
 * @param cwd the directory paths are resolved against
 * @returns the process exit code
 */
export const runCli = async (
  args: string[],
  output: CommandOutput = console,
  cwd: string = process.cwd()
): Promise<number> => {
  const [commandName, ...commandArgs] = args
  if (!commandName || commandName === '--help' || commandName === '-h') {
    output.log(USAGE)
    return commandName ? 0 : 2
  }
  const command = COMMANDS[commandName]
  if (!command) {
    output.error(`Unknown command: ${commandName}\n\n${USAGE}`)
    return 2
  }
  return command(commandArgs, output, cwd)
}
