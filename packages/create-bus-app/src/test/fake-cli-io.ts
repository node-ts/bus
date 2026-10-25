import { CliIo } from '../cli-io'

/**
 * A terminal that answers questions from a list, and records what's written
 */
export class FakeCliIo implements CliIo {
  readonly logged: string[] = []
  readonly errors: string[] = []
  readonly questions: string[] = []
  closed = false

  constructor(
    readonly isInteractive: boolean,
    private readonly answers: string[] = []
  ) {}

  log(message: string): void {
    this.logged.push(message)
  }

  error(message: string): void {
    this.errors.push(message)
  }

  async ask(question: string): Promise<string> {
    this.questions.push(question)
    const answer = this.answers.shift()
    if (answer === undefined) {
      throw new Error(`No answer for: ${question}`)
    }
    return answer
  }

  close(): void {
    this.closed = true
  }
}
