import type { CliIO } from './cli-io.js'

export function printWalletTable(io: CliIO, rows: [string, string][]): void {
  const c1 = Math.max(9, ...rows.map(([id]) => id.length))
  const c2 = Math.max(4, ...rows.map(([, type]) => type.length))
  const hr = (left: string, middle: string, right: string) =>
    `${left}${'─'.repeat(c1 + 2)}${middle}${'─'.repeat(c2 + 2)}${right}`
  io.print(hr('┌', '┬', '┐'))
  io.print(`│ ${'Wallet ID'.padEnd(c1)} │ ${'Type'.padEnd(c2)} │`)
  io.print(hr('├', '┼', '┤'))
  for (const [id, type] of rows) io.print(`│ ${id.padEnd(c1)} │ ${type.padEnd(c2)} │`)
  io.print(hr('└', '┴', '┘'))
}

export function printDetailRows(io: CliIO, rows: [string, string][]): void {
  const width = Math.max(...rows.map(([label]) => label.length))
  for (const [label, value] of rows) io.print(`${label.padEnd(width)}  ${value}`)
}
