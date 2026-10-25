import {
  CommandOutput,
  runGenerateMessageTypes
} from './generate-message-types/run-generate-message-types'
import { runProvision } from './provision/run-provision'
import { runPrune } from './prune/run-prune'

type Command = (
  args: string[],
  output: CommandOutput,
  cwd: string
) => Promise<number>

const COMMANDS: { [name: string]: Command } = {
  'generate-message-types': runGenerateMessageTypes,
  provision: runProvision,
  prune: runPrune
}

const USAGE = `Usage: bus <command> [options]

Commands:
  generate-message-types  Generate the runtime types of messages, so Dates and class instances are restored
  provision               Create the queues, topics, tables and indexes a bus needs, at deploy time
  prune                   Find and remove the subscriptions and bindings a bus no longer needs, after a rollout

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
