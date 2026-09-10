import type { CliIO } from './cli-io.js'

const DIR = '  --dir, -d <path>      Secrets directory path (default: ~/.agent-wallet)'
const HELP = '  --help, -h            Show this help message'

export function showCommandHelp(command: string, subcommand: string | undefined, io: CliIO): 0 {
  if (command === 'start' || command === 'add') {
    const verb = command
    if (subcommand === 'raw_secret') {
      lines(io, [
        `Usage: agent-wallet ${verb} raw_secret [options]`,
        '',
        `${verb === 'start' ? 'Quick start with' : 'Add'} a plaintext raw secret wallet.`,
        '',
        'Options:',
        '  --wallet-id, -w <id>  Wallet ID',
        '  --private-key, -k <key>  Import from private key',
        '  --mnemonic, -m <phrase>  Import from mnemonic',
        '  --derive-as <profile> Mnemonic derivation: eip155 or tron',
        '  --mnemonic-index, -mi <n>  Mnemonic account index (default: 0)',
        DIR,
        HELP,
      ])
      return 0
    }
    if (subcommand === 'privy') {
      lines(io, [
        `Usage: agent-wallet ${verb} privy [options]`,
        '',
        `${verb === 'start' ? 'Quick start by linking' : 'Add'} an existing Privy wallet.`,
        '',
        'Options:',
        '  --wallet-id, -w <id>  Wallet ID',
        '  --app-id <id>         Privy app id',
        '  --app-secret <secret>  Privy app secret',
        '  --app-secret-exec <path>  Privy app secret via exec script',
        '  --privy-wallet-id <id>  Existing Privy wallet id',
        DIR,
        HELP,
      ])
      return 0
    }
    if (subcommand === 'wallet_cli') {
      lines(io, [
        `Usage: agent-wallet ${verb} wallet_cli [options]`,
        '',
        `${verb === 'start' ? 'Link' : 'Add'} an existing wallet-cli account as a TRON + EVM signer.`,
        'This does not create or import wallet-cli keys.',
        '',
        'Options:',
        '  --wallet-id, -w <id>  Wallet ID',
        '  --account <label>     Existing wallet-cli account label/id (uses active if omitted)',
        '  --cli-password-exec <path>  wallet-cli password via exec script',
        DIR,
        HELP,
      ])
      return 0
    }
    lines(io, [
      `Usage: agent-wallet ${verb} [options]`,
      `       agent-wallet ${verb} <raw_secret|privy|wallet_cli> [options]`,
      '',
      'Subcommands:',
      '  raw_secret          Plaintext raw secret wallet',
      '  privy               Link an existing Privy wallet',
      '  wallet_cli          Link an existing wallet-cli account (TRON + EVM)',
      '',
      DIR,
      HELP,
    ])
    return 0
  }

  if (command === 'sign') {
    const usage =
      subcommand === 'tx'
        ? 'Usage: agent-wallet sign tx <payload> [options]'
        : subcommand === 'typed-data'
          ? 'Usage: agent-wallet sign typed-data <data> [options]'
          : 'Usage: agent-wallet sign <tx|typed-data> <data> [options]'
    lines(io, [
      usage,
      '',
      'Options:',
      '  --wallet-id, -w <id>  Wallet ID (uses active wallet if omitted)',
      '  --network, -n <net>   Canonical CAIP-2 network (e.g. eip155:1, tron:3448148188)',
      DIR,
      HELP,
    ])
    return 0
  }

  const usages: Record<string, string> = {
    list: 'Usage: agent-wallet list [options]',
    use: 'Usage: agent-wallet use [wallet-id] [options]',
    inspect: 'Usage: agent-wallet inspect <wallet-id> [options]',
    'resolve-address': 'Usage: agent-wallet resolve-address [wallet-id] [options]',
    remove: 'Usage: agent-wallet remove [wallet-id] [options]',
    reset: 'Usage: agent-wallet reset [options]',
  }
  if (usages[command]) {
    lines(io, [usages[command], '', 'Options:', DIR, HELP])
    return 0
  }

  lines(io, [
    'Usage: agent-wallet <command> [options]',
    '',
    'Commands:',
    '  start             Quick setup: init + configure wallet',
    '  add               Add a wallet configuration',
    '  list              List all configured wallets',
    '  use [id]          Set the active wallet',
    '  inspect <id>      Show wallet details',
    '  resolve-address [id]  Resolve wallet addresses',
    '  remove [id]       Remove a wallet',
    '  sign              Sign transactions or typed data',
    '  reset             Delete all wallet data',
    '',
    DIR,
    HELP,
  ])
  return 0
}

function lines(io: CliIO, values: string[]): void {
  for (const value of values) io.print(value)
}
