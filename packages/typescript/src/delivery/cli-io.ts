import { join } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'

export function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

export const DEFAULT_DIR = expandTilde(
  process.env.AGENT_WALLET_DIR ?? join(homedir(), '.agent-wallet'),
)

export interface CliIO {
  interactive?: boolean
  print(msg: string): void
  prompt(
    question: string,
    opts?: { password?: boolean; choices?: string[]; defaultValue?: string },
  ): Promise<string>
  confirm(question: string, defaultValue?: boolean): Promise<boolean>
  select?(
    promptText: string,
    choices: string[],
    descriptions?: Record<string, string>,
  ): Promise<string | null>
}

export class CliExit extends Error {
  constructor(public code: number) {
    super(`Exit ${code}`)
    this.name = 'CliExit'
  }
}

async function loadInquirer() {
  if (!process.stdin.isTTY) return null
  try {
    return await import('@inquirer/prompts')
  } catch {
    return null
  }
}

async function interactiveSelect(
  promptText: string,
  choices: string[],
  descriptions?: Record<string, string>,
): Promise<string | null> {
  const inquirer = await loadInquirer()
  if (!inquirer) return null
  return inquirer.select({
    message: promptText,
    choices: choices.map((c) => ({
      name: descriptions?.[c] ? `${c}  — ${descriptions[c]}` : c,
      value: c,
    })),
  })
}

export function createConsoleIO(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): CliIO {
  return {
    interactive: Boolean(process.stdin.isTTY),
    print(msg: string) {
      output.write(msg + '\n')
    },

    async prompt(question, opts) {
      if (opts?.choices && !opts.password) {
        const selected = await interactiveSelect(question, opts.choices)
        if (selected !== null) return selected
      }
      if (opts?.password) {
        const inquirer = await loadInquirer()
        if (inquirer) {
          const val = await inquirer.password({ message: question })
          return val || opts.defaultValue || ''
        }
      }
      const rl = createInterface({ input, output, terminal: false })
      return new Promise<string>((resolve) => {
        const suffix = opts?.choices ? ` [${opts.choices.join('/')}]` : ''
        const def = opts?.defaultValue ? ` (${opts.defaultValue})` : ''
        rl.question(`${question}${suffix}${def}: `, (answer) => {
          rl.close()
          resolve(answer.trim() || opts?.defaultValue || '')
        })
      })
    },

    async confirm(question, defaultValue = false) {
      const inquirer = await loadInquirer()
      if (inquirer) {
        return inquirer.confirm({ message: question, default: defaultValue })
      }
      const rl = createInterface({ input, output, terminal: false })
      return new Promise<boolean>((resolve) => {
        const hint = defaultValue ? '[Y/n]' : '[y/N]'
        rl.question(`${question} ${hint}: `, (answer) => {
          rl.close()
          const a = answer.trim().toLowerCase()
          if (!a) resolve(defaultValue)
          else resolve(a === 'y' || a === 'yes')
        })
      })
    },

    select: interactiveSelect,
  }
}

function requireInteractive(io: CliIO, action: string): void {
  if (io.interactive !== false) return
  io.print(
    `Cannot prompt for ${action} in a non-interactive environment. Pass the required flags explicitly.`,
  )
  throw new CliExit(1)
}

export async function promptInput(
  io: CliIO,
  question: string,
  opts?: { password?: boolean; choices?: string[]; defaultValue?: string },
  action?: string,
): Promise<string> {
  requireInteractive(io, action ?? question.toLowerCase())
  return io.prompt(question, opts)
}

export async function confirmInput(
  io: CliIO,
  question: string,
  defaultValue = false,
  action?: string,
): Promise<boolean> {
  requireInteractive(io, action ?? question.toLowerCase())
  return io.confirm(question, defaultValue)
}

export async function selectInput(
  io: CliIO,
  promptText: string,
  choices: string[],
  descriptions?: Record<string, string>,
  defaultValue?: string,
  action?: string,
): Promise<string> {
  requireInteractive(io, action ?? promptText.toLowerCase())
  return (
    (await io.select?.(promptText, choices, descriptions)) ??
    (await io.prompt(promptText, { choices, defaultValue: defaultValue ?? choices[0] }))
  )
}
