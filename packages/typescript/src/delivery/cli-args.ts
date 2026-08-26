export interface ParsedArgs {
  command: string
  subcommand?: string
  args: string[]
  options: Record<string, string | boolean>
}

/** Parse argv without depending on prompts, filesystem state, or command handlers. */
export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const options: Record<string, string | boolean> = {}

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const separator = arg.indexOf('=')
      if (separator > 2) {
        options[arg.slice(2, separator)] = arg.slice(separator + 1)
        i += 1
        continue
      }
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        options[key] = next
        i += 2
      } else {
        options[key] = true
        i += 1
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1)
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        options[key] = next
        i += 2
      } else {
        options[key] = true
        i += 1
      }
    } else {
      positional.push(arg)
      i += 1
    }
  }

  const command = positional[0] ?? ''
  const subcommand = positional.length > 1 ? positional[1] : undefined
  const args = positional.slice(command === 'sign' ? 2 : 1)

  return { command, subcommand, args, options }
}
