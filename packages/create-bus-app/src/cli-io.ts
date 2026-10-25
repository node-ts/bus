import { createInterface, Interface } from 'node:readline/promises'

/**
 * How the command line talks to the person running it, so tests can stand in for the terminal
 */
export interface CliIo {
  /**
   * Whether questions can be asked: stdin and stdout are a terminal
   */
  readonly isInteractive: boolean
  /**
   * Writes a line to stdout
   */
  log(message: string): void
  /**
   * Writes a line to stderr
   */
  error(message: string): void
  /**
   * Asks a question and waits for the answer
   * @returns the answer, as typed
   */
  ask(question: string): Promise<string>
  /**
   * Stops reading answers, so the process can exit
   */
  close(): void
}

/**
 * Talks to the person through the process' stdin, stdout and stderr
 */
export const processIo = (): CliIo => {
  let readline: Interface | undefined
  return {
    isInteractive: !!process.stdin.isTTY && !!process.stdout.isTTY,
    log: message => console.log(message),
    error: message => console.error(message),
    ask: question => {
      if (!readline) {
        readline = createInterface({
          input: process.stdin,
          output: process.stdout
        })
        // Ctrl+C while a question is asked
        readline.on('SIGINT', () => {
          readline?.close()
          console.log()
          process.exit(130)
        })
      }
      return readline.question(question)
    },
    close: () => readline?.close()
  }
}
