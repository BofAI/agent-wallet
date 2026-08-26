import { WalletError } from '../core/errors.js'
import { cmdAdd, cmdStart } from './cli.js'
import { CliExit, DEFAULT_DIR, createConsoleIO, expandTilde, type CliIO } from './cli-io.js'
import {
  cmdInspect,
  cmdList,
  cmdRemove,
  cmdReset,
  cmdResolveAddress,
  cmdSignTx,
  cmdSignTypedData,
  cmdUse,
} from './cli-wallet-commands.js'
import { parseArgs } from './cli-args.js'
import { showCommandHelp } from './cli-help.js'

export async function main(argv?: string[], io?: CliIO): Promise<number> {
  const cliIO = io ?? createConsoleIO()
  const rawArgs = argv ?? process.argv.slice(2)
  if (rawArgs.length === 0) return showCommandHelp('', undefined, cliIO)

  const { command, subcommand, args, options } = parseArgs(rawArgs)
  if (options['cli-password'] !== undefined) {
    cliIO.print(
      '--cli-password is not supported because secrets must not be passed in argv; use an interactive prompt or --cli-password-exec <path>.',
    )
    return 1
  }
  if (options.help === true || options.h === true) {
    return showCommandHelp(command, subcommand, cliIO)
  }

  const dir = expandTilde((options.dir ?? options.d ?? DEFAULT_DIR) as string)
  const mnemonicIndex = (options['mnemonic-index'] ?? options.mi) as string | undefined
  try {
    if (command === 'start' || command === 'add') {
      const input = {
        walletType: subcommand,
        walletId: (options['wallet-id'] ?? options.w) as string | undefined,
        generate: options.generate === true || options.g === true,
        privateKey: (options['private-key'] ?? options.k) as string | undefined,
        mnemonic: (options.mnemonic ?? options.m) as string | undefined,
        deriveAs: options['derive-as'] as string | undefined,
        mnemonicIndex: mnemonicIndex ? Number(mnemonicIndex) : undefined,
        appId: options['app-id'] as string | undefined,
        appSecret: options['app-secret'] as string | undefined,
        privyWalletId: options['privy-wallet-id'] as string | undefined,
        cliAccount: options.account as string | undefined,
        cliPasswordExec: options['cli-password-exec'] as string | undefined,
        appSecretExec: options['app-secret-exec'] as string | undefined,
      }
      if (command === 'start') {
        await cmdStart(dir, cliIO, { ...input, override: options.override === true })
      } else {
        await cmdAdd(dir, cliIO, input)
      }
    } else if (command === 'list') await cmdList(dir, cliIO)
    else if (command === 'use') await cmdUse(subcommand ?? args[0], dir, cliIO)
    else if (command === 'inspect') {
      if (!subcommand && args.length === 0) return usage(cliIO, 'agent-wallet inspect <wallet-id>')
      await cmdInspect(subcommand ?? args[0], dir, cliIO)
    } else if (command === 'resolve-address') {
      await cmdResolveAddress(subcommand ?? args[0], dir, cliIO)
    } else if (command === 'remove') {
      await cmdRemove(subcommand ?? args[0], dir, bool(options.yes, options.y), cliIO)
    } else if (command === 'reset') {
      await cmdReset(dir, bool(options.yes, options.y), cliIO)
    } else if (command === 'sign') {
      const walletId = (options['wallet-id'] ?? options.w) as string | undefined
      const network = (options.network ?? options.n) as string | undefined
      if (subcommand === 'tx') await cmdSignTx(walletId, args[0], network, dir, cliIO)
      else if (subcommand === 'typed-data') {
        await cmdSignTypedData(walletId, args[0], network, dir, cliIO)
      } else return usage(cliIO, 'agent-wallet sign <tx|typed-data> <data> [options]')
    } else {
      cliIO.print(`Unknown command: ${command}`)
      return 1
    }
  } catch (error) {
    if (error instanceof CliExit) return error.code
    if (error instanceof WalletError) {
      cliIO.print(error.message)
      return 1
    }
    if (error instanceof Error && error.message.startsWith('Invalid wallet config in ')) {
      cliIO.print(error.message)
      return 1
    }
    throw error
  }
  return 0
}

function bool(...values: unknown[]): boolean {
  return values.some((value) => value === true)
}

function usage(io: CliIO, command: string): 1 {
  io.print(`Usage: ${command}`)
  return 1
}
