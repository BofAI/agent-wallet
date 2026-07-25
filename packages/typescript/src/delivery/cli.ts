/**
 * AgentWallet CLI — key management and signing operations.
 */

import { existsSync, unlinkSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'

import { WalletType, type Eip712Capable } from '../core/base.js'
import {
  type PrivyWalletParams,
  type RawSecretMnemonicParams,
  type RawSecretPrivateKeyParams,
  type WalletCliWalletParams,
  type WalletConfig,
} from '../core/config.js'
import { WALLETS_CONFIG_FILENAME } from '../core/constants.js'
import { WalletError } from '../core/errors.js'
import { WalletCliNotFoundError } from '../core/errors.js'
import { WalletCliClient } from '../core/clients/wallet-cli.js'
import { ConfigWalletProvider } from '../core/providers/config-provider.js'
import { decodePrivateKey } from '../core/utils/keys.js'
import { parseNetworkFamily } from '../core/utils/network.js'
import { type SecretValue } from '../core/secret-resolver.js'

// --- Helpers ---
export function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

const DEFAULT_DIR = expandTilde(process.env.AGENT_WALLET_DIR ?? join(homedir(), '.agent-wallet'))

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

function createConsoleIO(
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

async function promptInput(
  io: CliIO,
  question: string,
  opts?: { password?: boolean; choices?: string[]; defaultValue?: string },
  action?: string,
): Promise<string> {
  requireInteractive(io, action ?? question.toLowerCase())
  return io.prompt(question, opts)
}

async function confirmInput(
  io: CliIO,
  question: string,
  defaultValue = false,
  action?: string,
): Promise<boolean> {
  requireInteractive(io, action ?? question.toLowerCase())
  return io.confirm(question, defaultValue)
}

async function selectInput(
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

function getProvider(dir: string): ConfigWalletProvider {
  try {
    return new ConfigWalletProvider(dir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid wallet config in ${join(dir, WALLETS_CONFIG_FILENAME)}: ${message}`, {
      cause: error,
    })
  }
}

function managedJsonFiles(dir: string): string[] {
  const files: string[] = []
  if (existsSync(join(dir, WALLETS_CONFIG_FILENAME))) files.push(WALLETS_CONFIG_FILENAME)
  return files
}

// --- Exit signal ---
export class CliExit extends Error {
  constructor(public code: number) {
    super(`Exit ${code}`)
    this.name = 'CliExit'
  }
}

// --- Wallet type resolution ---

async function selectWalletType(
  explicit: string | undefined,
  io: CliIO,
  promptText: string = 'Quick start type',
): Promise<WalletType> {
  if (explicit !== undefined) {
    if (
      explicit === WalletType.RAW_SECRET ||
      explicit === WalletType.PRIVY ||
      explicit === WalletType.WALLET_CLI
    ) {
      return explicit
    }
    io.print(`Unknown wallet type: ${explicit}. Use: ${Object.values(WalletType).join(', ')}`)
    throw new CliExit(1)
  }
  const choices = Object.values(WalletType) as string[]
  const descriptions: Record<string, string> = {
    raw_secret: 'Private key/mnemonic saved in plaintext config',
    privy: 'Privy API-backed wallet',
    wallet_cli: 'wallet-cli managed wallet (TRON, BSC planned)',
  }
  const selected = await selectInput(
    io,
    promptText,
    choices,
    descriptions,
    undefined,
    promptText.toLowerCase(),
  )

  if (
    selected === WalletType.RAW_SECRET ||
    selected === WalletType.PRIVY ||
    selected === WalletType.WALLET_CLI
  ) {
    return selected
  }

  io.print(`Wallet type required. Use: ${choices.join(', ')}`)
  throw new CliExit(1)
}

// --- Import source resolution ---

function selectImportSource(opts: {
  generate?: boolean
  privateKey?: string
  mnemonic?: string
  allowGenerate: boolean
}): string {
  const count = [opts.generate, opts.privateKey, opts.mnemonic].filter(Boolean).length
  if (count > 1) throw new Error('Use only one of --generate, --private-key or --mnemonic.')
  if (opts.generate) {
    if (opts.generate) throw new Error('--generate is not supported.')
    return 'generate'
  }
  if (opts.privateKey) return 'private_key'
  if (opts.mnemonic) return 'mnemonic'
  throw new Error('Import source selection requires interactive resolution.')
}

async function promptWalletId(
  io: CliIO,
  defaultValue: string,
  provider?: ConfigWalletProvider,
): Promise<string> {
  while (true) {
    const name = await promptInput(
      io,
      'Wallet ID (e.g. my_wallet_1)',
      { defaultValue },
      'wallet id',
    )
    if (provider) {
      try {
        provider.getWalletConfig(name)
        io.print(`Wallet '${name}' already exists. Please choose a different ID.`)
        continue
      } catch {
        // WalletNotFoundError — name is available
      }
    }
    return name
  }
}

async function selectImportSourceInteractive(
  io: CliIO,
  opts: {
    generate?: boolean
    privateKey?: string
    mnemonic?: string
    allowGenerate: boolean
  },
): Promise<string> {
  try {
    return selectImportSource(opts)
  } catch (error) {
    if ((error as Error).message !== 'Import source selection requires interactive resolution.') {
      throw error
    }
  }

  const choices = opts.allowGenerate
    ? ['generate', 'private_key', 'mnemonic']
    : ['private_key', 'mnemonic']
  const descriptions: Record<string, string> = {
    generate: 'Generate a new random private key',
    private_key: 'Import an existing hex private key',
    mnemonic: 'Derive from a BIP-39 mnemonic phrase',
  }
  return selectInput(io, 'Import source', choices, descriptions, choices[0], 'import source')
}

async function promptDerivationProfile(io: CliIO): Promise<string> {
  const choices = ['eip155', 'tron']
  const descriptions: Record<string, string> = {
    eip155: 'EVM chains (Ethereum, BSC, Polygon, etc.)',
    tron: 'TRON network',
  }
  return selectInput(
    io,
    'Derive mnemonic as',
    choices,
    descriptions,
    'eip155',
    'mnemonic derivation profile',
  )
}

async function promptMnemonicMaterial(
  io: CliIO,
  mnemonic: string | undefined,
  mnemonicIndex: number,
): Promise<{ mnemonic: string; mnemonicIndex: number }> {
  if (mnemonic !== undefined) {
    return { mnemonic: mnemonic.trim(), mnemonicIndex }
  }

  while (true) {
    const promptedMnemonic = (
      await promptInput(io, 'Paste mnemonic phrase', { password: true }, 'mnemonic phrase')
    ).trim()
    if (!promptedMnemonic) {
      io.print('Paste mnemonic phrase is required.')
      continue
    }
    const promptedIndex = await promptInput(
      io,
      'Account index (0 = first account)',
      { defaultValue: String(mnemonicIndex) },
      'account index',
    )
    const parsedIndex = Number(promptedIndex)
    if (!Number.isInteger(parsedIndex) || parsedIndex < 0) {
      io.print('Invalid account index.')
      continue
    }
    return { mnemonic: promptedMnemonic, mnemonicIndex: parsedIndex }
  }
}

async function promptPrivateKey(io: CliIO, explicitPrivateKey?: string): Promise<Buffer> {
  if (explicitPrivateKey !== undefined) {
    return Buffer.from(decodePrivateKey(explicitPrivateKey))
  }
  while (true) {
    const keyHex = await promptInput(
      io,
      'Paste private key (hex)',
      { password: true },
      'private key',
    )
    try {
      return Buffer.from(decodePrivateKey(keyHex))
    } catch (error) {
      io.print((error as Error).message)
    }
  }
}

/**
 * Interactive credential prompt: let user choose between direct input or exec script.
 */
async function promptCredential(io: CliIO, label: string): Promise<SecretValue> {
  const source = await selectInput(
    io,
    `${label} source`,
    ['direct', 'exec'],
    {
      direct: 'Enter value directly',
      exec: 'Use exec script (e.g. 1Password CLI)',
    },
    'direct',
    'credential source',
  )

  if (source === 'exec') {
    const scriptPath = (await promptRequired(io, `${label} exec script path`)).trim()
    return { exec: scriptPath }
  }

  const value = await promptRequired(io, label, { password: true })
  return value
}

async function buildRawSecretConfig(
  io: CliIO,
  opts: {
    privateKey?: string
    mnemonic?: string
    deriveAs?: string
    mnemonicIndex: number
  },
): Promise<WalletConfig> {
  const source = await selectImportSourceInteractive(io, {
    generate: false,
    privateKey: opts.privateKey,
    mnemonic: opts.mnemonic,
    allowGenerate: false,
  })

  if (source === 'private_key') {
    const normalized = '0x' + (await promptPrivateKey(io, opts.privateKey)).toString('hex')
    return {
      type: 'raw_secret',
      params: { source: 'private_key', private_key: normalized } as RawSecretPrivateKeyParams,
    }
  }

  if (opts.mnemonicIndex && !opts.mnemonic) {
    throw new Error('--mnemonic-index requires --mnemonic.')
  }
  const { mnemonic, mnemonicIndex } = await promptMnemonicMaterial(
    io,
    opts.mnemonic,
    opts.mnemonicIndex,
  )
  const derivationProfile = opts.deriveAs ?? (await promptDerivationProfile(io))
  parseNetworkFamily(derivationProfile)
  return {
    type: 'raw_secret',
    params: {
      source: 'mnemonic',
      mnemonic,
      account_index: mnemonicIndex,
    } as RawSecretMnemonicParams,
  }
}

async function promptRequired(
  io: CliIO,
  label: string,
  opts?: { password?: boolean },
): Promise<string> {
  while (true) {
    const value = await promptInput(io, label, { password: opts?.password }, label.toLowerCase())
    const trimmed = value.trim()
    if (trimmed) return trimmed
    io.print(`${label} is required.`)
  }
}

async function buildPrivyConfigWithFlags(
  io: CliIO,
  provider?: ConfigWalletProvider,
  opts?: {
    appId?: string
    appSecret?: string
    appSecretExec?: string
    privyWalletId?: string
  },
): Promise<WalletConfig> {
  const existing = provider
    ? provider.listWallets().filter(([, conf]) => conf.type === WalletType.PRIVY)
    : []
  if (existing.length > 0 && opts?.appId == null && opts?.appSecret == null) {
    const reuseChoice = 'Enter new Privy credentials'
    const choices = existing.map(([walletId]) => walletId).concat(reuseChoice)
    const selection = await selectInput(
      io,
      'Select existing Privy wallet or enter new credentials',
      choices,
      undefined,
      choices[0],
      'privy wallet selection',
    )
    if (selection && selection !== reuseChoice) {
      const conf = provider?.getWalletConfig(selection)
      if (!conf || conf.type !== WalletType.PRIVY) {
        throw new Error('Selected Privy wallet is no longer available')
      }
      const params = conf.params as PrivyWalletParams
      const walletId = opts?.privyWalletId ?? (await promptRequired(io, 'Privy wallet id'))
      return {
        type: 'privy',
        params: {
          app_id: params.app_id,
          app_secret: params.app_secret,
          wallet_id: walletId,
        },
      }
    }
  }

  const appId = opts?.appId ?? (await promptRequired(io, 'Privy app id'))
  let appSecret: SecretValue
  if (opts?.appSecretExec) {
    appSecret = { exec: opts.appSecretExec }
  } else if (opts?.appSecret) {
    appSecret = opts.appSecret
  } else {
    appSecret = await promptCredential(io, 'Privy app secret')
  }
  const walletId = opts?.privyWalletId ?? (await promptRequired(io, 'Privy wallet id'))

  return {
    type: 'privy',
    params: {
      app_id: appId,
      app_secret: appSecret as SecretValue,
      wallet_id: walletId,
    },
  }
}

async function buildWalletCliConfigWithFlags(
  io: CliIO,
  opts?: {
    account?: string
    cliPassword?: string
    cliPasswordExec?: string
  },
): Promise<WalletConfig> {
  const account =
    opts?.account ??
    (
      await promptInput(
        io,
        'wallet-cli account label (optional, press Enter to use active)',
        {},
        'wallet-cli account',
      )
    ).trim()

  let password: SecretValue
  if (opts?.cliPasswordExec) {
    password = { exec: opts.cliPasswordExec }
  } else if (opts?.cliPassword) {
    password = opts.cliPassword
  } else {
    password = await promptCredential(io, 'wallet-cli keystore password')
  }

  return {
    type: 'wallet_cli',
    params: {
      ...(account ? { account } : {}),
      password,
    } as WalletCliWalletParams,
  }
}

/**
 * Probe wallet-cli availability after a wallet_cli wallet is created.
 * Catches errors non-fatally so the wallet is still saved; the user is
 * prompted to install wallet-cli if the binary is missing.
 */
async function probeWalletCli(
  io: CliIO,
  account?: string,
): Promise<void> {
  const client = new WalletCliClient()
  try {
    await client.currentAccount(account)
    return
  } catch (e) {
    if (!(e instanceof WalletCliNotFoundError)) {
      io.print(`\nWarning: could not reach wallet-cli: ${(e as Error).message}`)
      return
    }
    // binary not found — prompt to install in interactive mode
    if (io.interactive === false) {
      io.print(
        '\nWarning: wallet-cli binary not found. Install it to use this wallet:\n  npm i -g @tron-walletcli/wallet-cli\nOr set AGENT_WALLET_WALLET_CLI_PATH to the binary path.',
      )
      return
    }
    const install = await confirmInput(
      io,
      'wallet-cli binary not found. Install @tron-walletcli/wallet-cli now?',
      true,
      'wallet-cli install',
    )
    if (!install) {
      io.print(
        'Skipped. Install manually: npm i -g @tron-walletcli/wallet-cli\nOr set AGENT_WALLET_WALLET_CLI_PATH to the binary path.',
      )
      return
    }
    await installWalletCli(io)
  }
}

async function installWalletCli(io: CliIO): Promise<void> {
  io.print('Installing @tron-walletcli/wallet-cli ...')
  const code = await new Promise<number>((resolve) => {
    const child = spawn('npm', ['install', '-g', '@tron-walletcli/wallet-cli'], {
      stdio: 'inherit',
      env: process.env,
    })
    child.on('close', resolve)
    child.on('error', () => resolve(1))
  })
  if (code !== 0) {
    io.print(
      'Installation failed. Install manually: npm i -g @tron-walletcli/wallet-cli\nOr set AGENT_WALLET_WALLET_CLI_PATH to the binary path.',
    )
    return
  }
  io.print('wallet-cli installed successfully.')
}

// --- Commands ---

export async function cmdStart(
  dir: string,
  io: CliIO,
  opts?: {
    walletType?: string
    walletId?: string
    generate?: boolean
    privateKey?: string
    mnemonic?: string
    deriveAs?: string
    mnemonicIndex?: number
    override?: boolean
    appId?: string
    appSecret?: string
    privyWalletId?: string
    cliAccount?: string
    cliPassword?: string
    cliPasswordExec?: string
    appSecretExec?: string
  },
): Promise<void> {
  // Check if wallets already exist — prompt to confirm unless --override
  if (!opts?.override) {
    try {
      const existing = getProvider(dir)
      const rows = existing.listWallets()
      if (rows.length > 0) {
        const activeId = existing.getActiveId()
        io.print(`Already initialized with ${rows.length} wallet(s), active: ${activeId}`)
        const descriptions: Record<string, string> = {
          add: 'Configure a new wallet',
          exit: 'Exit without changes',
        }
        const choices = ['add', 'exit']
        const selected = await selectInput(
          io,
          'What would you like to do?',
          choices,
          descriptions,
          'exit',
          'existing wallet action',
        )
        if (selected === 'exit') {
          throw new CliExit(0)
        }
      }
    } catch (e) {
      if (e instanceof CliExit) throw e
      // No existing config — continue with normal start
    }
  }

  const wtype = await selectWalletType(opts?.walletType, io)
  let provider: ConfigWalletProvider

  if (wtype === WalletType.RAW_SECRET) {
    io.print('Warning: Raw secret material will be stored in plaintext in wallets_config.json.')
    provider = getProvider(dir)
    if (opts?.walletId) {
      try {
        provider.getWalletConfig(opts.walletId)
        io.print(`Wallet '${opts.walletId}' already exists.`)
        throw new CliExit(1)
      } catch (e) {
        if (e instanceof CliExit) throw e
      }
    }
    const targetName = opts?.walletId ?? (await promptWalletId(io, 'default_raw', provider))

    const rawConfig = await buildRawSecretConfig(io, {
      privateKey: opts?.privateKey,
      mnemonic: opts?.mnemonic,
      deriveAs: opts?.deriveAs,
      mnemonicIndex: opts?.mnemonicIndex ?? 0,
    })

   provider.ensureStorage()
   try {
     provider.addWallet(targetName, rawConfig)
     provider.setActive(targetName)
   } catch (e) {
      io.print((e as Error).message)
     throw new CliExit(1)
   }

    io.print(`\nWallet '${targetName}' created:`)
    printWalletTable(io, [[targetName, 'raw_secret']])
  } else if (wtype === WalletType.PRIVY) {
    provider = getProvider(dir)
    if (opts?.walletId) {
      try {
        provider.getWalletConfig(opts.walletId)
        io.print(`Wallet '${opts.walletId}' already exists.`)
        throw new CliExit(1)
      } catch (e) {
        if (e instanceof CliExit) throw e
      }
    }
    const targetName = opts?.walletId ?? (await promptWalletId(io, 'default_privy', provider))
    const privyConfig = await buildPrivyConfigWithFlags(io, provider, {
      appId: opts?.appId,
      appSecret: opts?.appSecret,
      appSecretExec: opts?.appSecretExec,
      privyWalletId: opts?.privyWalletId,
    })

   provider.ensureStorage()
   try {
     provider.addWallet(targetName, privyConfig)
     provider.setActive(targetName)
   } catch (e) {
      io.print((e as Error).message)
     throw new CliExit(1)
   }

    io.print(`\nWallet '${targetName}' created:`)
    printWalletTable(io, [[targetName, 'privy']])
  } else if (wtype === WalletType.WALLET_CLI) {
    provider = getProvider(dir)
    if (opts?.walletId) {
      try {
        provider.getWalletConfig(opts.walletId)
        io.print(`Wallet '${opts.walletId}' already exists.`)
        throw new CliExit(1)
      } catch (e) {
        if (e instanceof CliExit) throw e
      }
    }
    const targetName = opts?.walletId ?? (await promptWalletId(io, 'default_cli', provider))
    const cliConfig = await buildWalletCliConfigWithFlags(io, {
      account: opts?.cliAccount,
      cliPassword: opts?.cliPassword,
      cliPasswordExec: opts?.cliPasswordExec,
    })

   provider.ensureStorage()
   try {
     provider.addWallet(targetName, cliConfig)
     provider.setActive(targetName)
   } catch (e) {
      io.print((e as Error).message)
     throw new CliExit(1)
   }

    io.print(`\nWallet '${targetName}' created:`)
    printWalletTable(io, [[targetName, 'wallet_cli']])
    await probeWalletCli(io, opts?.cliAccount)
  } else {
    io.print(`Unsupported quick-start type: ${wtype}`)
    throw new CliExit(1)
  }

  io.print(`\nActive wallet: ${provider!.getActiveId()}`)
  io.print('\nQuick guide:')
  io.print('   agent-wallet list              -- View your wallets')
  io.print("   agent-wallet sign tx '{...}'   -- Sign a transaction")
  io.print('   agent-wallet start -h          -- See all options')
  io.print('')
}

export async function cmdAdd(
  dir: string,
  io: CliIO,
  opts?: {
    walletType?: string
    walletId?: string
    generate?: boolean
    privateKey?: string
    mnemonic?: string
    deriveAs?: string
    mnemonicIndex?: number
    appId?: string
    appSecret?: string
    privyWalletId?: string
    cliAccount?: string
    cliPassword?: string
    cliPasswordExec?: string
    appSecretExec?: string
  },
): Promise<void> {
  const wtype = await selectWalletType(opts?.walletType, io, 'Wallet type')
  const provider = getProvider(dir)
  provider.ensureStorage()

  if (opts?.walletId) {
    try {
      provider.getWalletConfig(opts.walletId)
      io.print(`Wallet '${opts.walletId}' already exists.`)
      throw new CliExit(1)
    } catch (e) {
      if (e instanceof CliExit) throw e
      // WalletNotFoundError — name is available
    }
  }
  let targetName!: string
  if (wtype === WalletType.RAW_SECRET) {
    io.print('Warning: Raw secret material will be stored in plaintext in wallets_config.json.')
    targetName = opts?.walletId ?? (await promptWalletId(io, 'default_raw', provider))
    provider.addWallet(
      targetName,
      await buildRawSecretConfig(io, {
        privateKey: opts?.privateKey,
        mnemonic: opts?.mnemonic,
        deriveAs: opts?.deriveAs,
        mnemonicIndex: opts?.mnemonicIndex ?? 0,
      }),
    )
  } else if (wtype === WalletType.PRIVY) {
    targetName = opts?.walletId ?? (await promptWalletId(io, 'default_privy', provider))
    provider.addWallet(
      targetName,
      await buildPrivyConfigWithFlags(io, provider, {
        appId: opts?.appId,
        appSecret: opts?.appSecret,
        appSecretExec: opts?.appSecretExec,
        privyWalletId: opts?.privyWalletId,
      }),
    )
  } else if (wtype === WalletType.WALLET_CLI) {
    targetName = opts?.walletId ?? (await promptWalletId(io, 'default_cli', provider))
    provider.addWallet(
      targetName,
      await buildWalletCliConfigWithFlags(io, {
        account: opts?.cliAccount,
        cliPassword: opts?.cliPassword,
        cliPasswordExec: opts?.cliPasswordExec,
      }),
    )
    await probeWalletCli(io, opts?.cliAccount)
  }

  io.print(`Wallet '${targetName}' added. Config updated.`)
  if (provider.getActiveId() === targetName) {
    io.print(`  Active wallet set to '${targetName}'.`)
  }
}

export async function cmdList(dir: string, io: CliIO): Promise<void> {
  const provider = getProvider(dir)
  const rows = provider.listWallets()

  if (rows.length === 0) {
    io.print('No wallets configured.')
    return
  }

  const cm = 1 // marker column
  const c1 = Math.max('Wallet ID'.length, ...rows.map(([wid]) => wid.length))
  const c2 = Math.max('Type'.length, ...rows.map(([, conf]) => conf.type.length))
  const hr = (l: string, m1: string, m2: string, r: string) =>
    `${l}${'─'.repeat(cm + 2)}${m1}${'─'.repeat(c1 + 2)}${m2}${'─'.repeat(c2 + 2)}${r}`
  io.print('Wallets:')
  io.print(hr('┌', '┬', '┬', '┐'))
  io.print(`│ ${' '.padEnd(cm)} │ ${'Wallet ID'.padEnd(c1)} │ ${'Type'.padEnd(c2)} │`)
  io.print(hr('├', '┼', '┼', '┤'))

  for (const [wid, conf, isActive] of rows) {
    const marker = isActive ? '*' : ' '
    io.print(`│ ${marker.padEnd(cm)} │ ${wid.padEnd(c1)} │ ${conf.type.padEnd(c2)} │`)
  }
  io.print(hr('└', '┴', '┴', '┘'))
}

export async function cmdInspect(walletId: string, dir: string, io: CliIO): Promise<void> {
  const provider = getProvider(dir)
  let conf: WalletConfig
  try {
    conf = provider.getWalletConfig(walletId)
  } catch {
    io.print(`Wallet '${walletId}' not found.`)
    throw new CliExit(1)
  }

  const rows: [string, string][] = [
    ['Wallet', walletId],
    ['Type', conf.type],
  ]
  if (conf.type === 'raw_secret') {
    const params = conf.params as RawSecretPrivateKeyParams | RawSecretMnemonicParams
    rows.push(['Source Type', params.source])
    if (params.source === 'private_key') {
      rows.push(['Private Key', '[redacted]'])
    } else if (params.source === 'mnemonic') {
      rows.push(['Mnemonic', '[redacted]'])
      rows.push(['Account Index', String(params.account_index)])
    }
  } else if (conf.type === 'privy') {
    rows.push(['Privy App ID', '[redacted]'])
    rows.push(['Privy App Secret', '[redacted]'])
    rows.push(['Privy Wallet ID', '[redacted]'])
  } else if (conf.type === 'wallet_cli') {
    const params = conf.params as WalletCliWalletParams
    rows.push(['Account', params.account ?? '(active)'])
    rows.push(['Keystore Password', '[redacted]'])
  }
  printDetailRows(io, rows)
}

export async function cmdResolveAddress(
  walletId: string | undefined,
  dir: string,
  io: CliIO,
): Promise<void> {
  const { resolveWalletAddresses } = await import('../core/address-resolution.js')
  const provider = getProvider(dir)
  let targetId = walletId
  if (!targetId) {
    const rows = provider.listWallets()
    if (rows.length === 0) {
      io.print('No wallets configured.')
      throw new CliExit(1)
    }
    const choices = rows.map(([wid]) => wid)
    const descriptions = Object.fromEntries(
      rows.map(([wid, conf, isActive]) => [wid, `${conf.type}${isActive ? ' (active)' : ''}`]),
    )
    targetId = await selectInput(
      io,
      'Select wallet to resolve',
      choices,
      descriptions,
      choices[0],
      'wallet selection',
    )
  }
  let conf: WalletConfig
  try {
    conf = provider.getWalletConfig(targetId)
  } catch {
    io.print(`Wallet '${targetId}' not found.`)
    throw new CliExit(1)
  }

  const result = await resolveWalletAddresses(conf)

  const rows: [string, string][] = [
    ['Wallet', targetId],
    ['Type', conf.type],
  ]
  if (result.mode === 'single') {
    rows.push([result.entries[0].label, result.entries[0].address])
    printDetailRows(io, rows)
    return
  }

  printDetailRows(io, rows)
  io.print('')
  io.print('Addresses')
  printDetailRows(
    io,
    result.entries.map((entry) => [entry.label, entry.address]),
  )
}

export async function cmdRemove(
  walletId: string | undefined,
  dir: string,
  yes: boolean,
  io: CliIO,
): Promise<void> {
  const provider = getProvider(dir)
  const activeBefore = provider.getActiveId()
  let targetId = walletId
  if (!targetId) {
    const rows = provider.listWallets()
    if (rows.length === 0) {
      io.print('No wallets configured.')
      throw new CliExit(1)
    }
    const choices = rows.map(([wid]) => wid)
    const descriptions = Object.fromEntries(
      rows.map(([wid, conf, isActive]) => [wid, `${conf.type}${isActive ? ' (active)' : ''}`]),
    )
    targetId = await selectInput(
      io,
      'Select wallet to remove',
      choices,
      descriptions,
      choices[0],
      'wallet removal selection',
    )
  }
  try {
    provider.getWalletConfig(targetId)
  } catch {
    io.print(`Wallet '${targetId}' not found.`)
    throw new CliExit(1)
  }

  if (!yes) {
    const confirmed = await confirmInput(
      io,
      `PERMANENTLY delete wallet '${targetId}'? This cannot be undone and the wallet configuration will be removed immediately.`,
      false,
      'wallet removal confirmation',
    )
    if (!confirmed) {
      io.print('Cancelled.')
      throw new CliExit(0)
    }
  }

  provider.removeWallet(targetId)
  io.print(`Wallet '${targetId}' removed.`)

  if (activeBefore === targetId) {
    const rows = provider.listWallets()
    if (rows.length > 0 && io.interactive !== false) {
      const reassign = await selectInput(
        io,
        'Removed the active wallet. Select a new active wallet now?',
        ['yes', 'no'],
        {
          yes: 'Choose a replacement active wallet',
          no: 'Leave active wallet unset',
        },
        'yes',
        'active wallet reassignment',
      )
      if (reassign === 'yes') {
        const choices = rows.map(([wid]) => wid)
        const descriptions = Object.fromEntries(
          rows.map(([wid, walletConf]) => [wid, walletConf.type]),
        )
        const newActive = await selectInput(
          io,
          'Select new active wallet',
          choices,
          descriptions,
          choices[0],
          'new active wallet selection',
        )
        provider.setActive(newActive)
        io.print(`Active wallet: ${newActive}`)
      }
    }
  }
}

export async function cmdUse(walletId: string, dir: string, io: CliIO): Promise<void> {
  const provider = getProvider(dir)
  let targetId = walletId
  if (!targetId) {
    const rows = provider.listWallets()
    if (rows.length === 0) {
      io.print('No wallets configured.')
      throw new CliExit(1)
    }
    const choices = rows.map(([wid]) => wid)
    const descriptions = Object.fromEntries(
      rows.map(([wid, conf, isActive]) => [wid, `${conf.type}${isActive ? ' (active)' : ''}`]),
    )
    const selected = await selectInput(
      io,
      'Select wallet',
      choices,
      descriptions,
      choices[0],
      'wallet selection',
    )
    targetId = selected
  }
  try {
    const conf = provider.setActive(targetId)
    io.print(`Active wallet: ${targetId} (${conf.type})`)
  } catch {
    io.print(`Wallet '${targetId}' not found.`)
    throw new CliExit(1)
  }
}

function resolveWalletId(explicit: string | undefined, dir: string, io: CliIO): string {
  if (explicit) return explicit
  const provider = getProvider(dir)
  if (!provider.isInitialized()) {
    io.print("Wallet config not initialized. Run 'agent-wallet start' first.")
    throw new CliExit(1)
  }
  const activeId = provider.getActiveId()
  if (activeId) return activeId
  io.print(
    "No wallet specified and no active wallet set. Use '--wallet-id <id>' or 'agent-wallet use [id]'.",
  )
  throw new CliExit(1)
}

// --- Sign subcommands ---

export async function cmdSignTx(
  wallet: string | undefined,
  payload: string,
  network: string | undefined,
  dir: string,
  io: CliIO,
): Promise<void> {
  const walletId = resolveWalletId(wallet, dir, io)
  const provider = getProvider(dir)

  try {
    const txData = JSON.parse(payload)
    const w = await provider.getWallet(walletId, network)
    const signed = await w.signTransaction(txData)
    try {
      const parsed = JSON.parse(signed)
      io.print('Signed tx:')
      io.print(JSON.stringify(parsed, null, 2))
    } catch {
      io.print(`Signed tx: ${signed}`)
    }
  } catch (e) {
    if (e instanceof WalletError || e instanceof SyntaxError) {
      io.print((e as Error).message)
      throw new CliExit(1)
    }
    if (e instanceof Error) {
      io.print(e.message)
      throw new CliExit(1)
    }
    throw e
  }
}

export async function cmdSignTypedData(
  wallet: string | undefined,
  data: string,
  network: string | undefined,
  dir: string,
  io: CliIO,
): Promise<void> {
  const walletId = resolveWalletId(wallet, dir, io)
  const provider = getProvider(dir)

  try {
    const w = await provider.getWallet(walletId, network)
    if (!('signTypedData' in w)) {
      io.print('This wallet does not support EIP-712 signing.')
      throw new CliExit(1)
    }
    const typedData = JSON.parse(data)
    const signature = await (w as unknown as Eip712Capable).signTypedData(typedData)
    io.print(`Signature: ${signature}`)
  } catch (e) {
    if (e instanceof WalletError || e instanceof SyntaxError) {
      io.print((e as Error).message)
      throw new CliExit(1)
    }
    if (e instanceof Error) {
      io.print(e.message)
      throw new CliExit(1)
    }
    throw e
  }
}

// --- Helpers (output) ---

function printWalletTable(io: CliIO, rows: [string, string][]): void {
  const c1 = Math.max(9, ...rows.map(([id]) => id.length))
  const c2 = Math.max(4, ...rows.map(([, type]) => type.length))
  const hr = (l: string, m: string, r: string) =>
    `${l}${'─'.repeat(c1 + 2)}${m}${'─'.repeat(c2 + 2)}${r}`
  io.print(hr('┌', '┬', '┐'))
  io.print(`│ ${'Wallet ID'.padEnd(c1)} │ ${'Type'.padEnd(c2)} │`)
  io.print(hr('├', '┼', '┤'))
  for (const [id, type] of rows) {
    io.print(`│ ${id.padEnd(c1)} │ ${type.padEnd(c2)} │`)
  }
  io.print(hr('└', '┴', '┘'))
}

function printDetailRows(io: CliIO, rows: [string, string][]): void {
  const width = Math.max(...rows.map(([label]) => label.length))
  for (const [label, value] of rows) {
    io.print(`${label.padEnd(width)}  ${value}`)
  }
}

// --- Reset Command ---

export async function cmdReset(dir: string, yes: boolean, io: CliIO): Promise<void> {
  const files = managedJsonFiles(dir)
  if (files.length === 0) {
    io.print('No wallet data found in: ' + dir)
    throw new CliExit(1)
  }

  io.print(`This will delete ALL wallet data in: ${dir}`)
  io.print(`   ${files.length} file(s): ${files.join(', ')}`)
  io.print('')

  if (!yes) {
    const confirmed = await confirmInput(
      io,
      'Are you sure you want to reset? This cannot be undone.',
      false,
      'wallet reset confirmation',
    )
    if (!confirmed) {
      io.print('Cancelled.')
      throw new CliExit(0)
    }
    const confirmed2 = await confirmInput(
      io,
      'Really delete everything? Last chance!',
      false,
      'wallet reset confirmation',
    )
    if (!confirmed2) {
      io.print('Cancelled.')
      throw new CliExit(0)
    }
  }

  for (const f of files) {
    unlinkSync(join(dir, f))
    io.print(`  Deleted: ${f}`)
  }
  io.print('')
  io.print('Wallet data reset complete.')
}

// --- CLI Entry Point ---

interface ParsedArgs {
  command: string
  subcommand?: string
  args: string[]
  options: Record<string, string | boolean>
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const options: Record<string, string | boolean> = {}

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        options[key] = next
        i += 2
      } else {
        options[key] = true
        i += 1
      }
    } else if (arg.startsWith('-') && !arg.startsWith('--')) {
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

export async function main(argv?: string[], io?: CliIO): Promise<number> {
  const cliIO = io ?? createConsoleIO()
  const rawArgs = argv ?? process.argv.slice(2)

  const DIR_OPT = '  --dir, -d <path>      Secrets directory path (default: ~/.agent-wallet)'
  const HELP_OPT = '  --help, -h            Show this help message'
  const WALLET_OPT = '  --wallet-id, -w <id>  Wallet ID (uses active wallet if omitted)'
  const NETWORK_OPT = '  --network, -n <net>   Target network (e.g. eip155:1, tron:nile)'
  const PRIVY_APP_ID_OPT = '  --app-id <id>         Privy app id'
  const PRIVY_APP_SECRET_OPT = '  --app-secret <secret>  Privy app secret'
  const PRIVY_WALLET_ID_OPT = '  --privy-wallet-id <id>  Privy wallet id'
  const CLI_ACCOUNT_OPT = '  --account <label>     wallet-cli account label (optional)'
  const CLI_PASSWORD_OPT = '  --cli-password <pw>   wallet-cli keystore password'
  const CLI_PASSWORD_EXEC_OPT = '  --cli-password-exec <path>  wallet-cli password via exec script'
  const PRIVY_APP_SECRET_EXEC_OPT = '  --app-secret-exec <path>  Privy app secret via exec script'

  const showCommandHelp = (command: string, subcommand: string | undefined, io: CliIO): 0 => {
    switch (command) {
      case 'start':
        if (subcommand === 'raw_secret') {
          io.print('Usage: agent-wallet start raw_secret [options]')
          io.print('')
          io.print('Quick start with a plaintext raw secret wallet.')
          io.print('')
          io.print('Options:')
          io.print('  --wallet-id, -w <id>  Wallet ID')
          io.print('  --private-key, -k <key>  Import from private key')
          io.print('  --mnemonic, -m <phrase>  Import from mnemonic')
          io.print('  --derive-as <profile> Mnemonic derivation: eip155 or tron')
          io.print('  --mnemonic-index, -mi <n>  Mnemonic account index (default: 0)')
          io.print('  --override            Skip confirmation when wallets already exist')
          io.print(DIR_OPT)
          io.print(HELP_OPT)
          break
        }
        if (subcommand === 'privy') {
          io.print('Usage: agent-wallet start privy [options]')
          io.print('')
          io.print('Quick start with a Privy-backed wallet.')
          io.print('')
          io.print('Options:')
          io.print('  --wallet-id, -w <id>  Wallet ID')
          io.print('  --override            Skip confirmation when wallets already exist')
          io.print(PRIVY_APP_ID_OPT)
          io.print(PRIVY_APP_SECRET_OPT)
          io.print(PRIVY_APP_SECRET_EXEC_OPT)
          io.print(PRIVY_WALLET_ID_OPT)
          io.print(DIR_OPT)
          io.print(HELP_OPT)
          break
        }
        if (subcommand === 'wallet_cli') {
          io.print('Usage: agent-wallet start wallet_cli [options]')
          io.print('')
          io.print('Quick start with a wallet-cli managed wallet (TRON; BSC planned).')
          io.print('')
          io.print('Options:')
          io.print('  --wallet-id, -w <id>  Wallet ID')
          io.print('  --override            Skip confirmation when wallets already exist')
          io.print(CLI_PASSWORD_EXEC_OPT)
          io.print(CLI_ACCOUNT_OPT)
          io.print(CLI_PASSWORD_OPT)
          io.print(DIR_OPT)
          io.print(HELP_OPT)
          break
        }
        io.print('Usage: agent-wallet start [options]')
        io.print('       agent-wallet start <raw_secret|privy|wallet_cli> [options]')
        io.print('')
        io.print('Quick setup: create and activate your first wallet.')
        io.print('')
        io.print('Options:')
        io.print('  --wallet-id, -w <id>  Wallet ID')
        io.print('  --override            Skip confirmation when wallets already exist')
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        io.print('')
        io.print('Subcommands:')
        io.print('  raw_secret          Quick start with a plaintext raw secret wallet')
        io.print('  privy               Quick start with a Privy-backed wallet')
        io.print(
          '  wallet_cli          Quick start with a wallet-cli managed wallet (TRON; BSC planned)',
        )
        break
      case 'add':
        if (subcommand === 'raw_secret') {
          io.print('Usage: agent-wallet add raw_secret [options]')
          io.print('')
          io.print('Add a plaintext raw secret wallet.')
          io.print('')
          io.print('Options:')
          io.print('  --wallet-id, -w <id>  Wallet ID')
          io.print('  --private-key, -k <key>  Import from private key')
          io.print('  --mnemonic, -m <phrase>  Import from mnemonic')
          io.print('  --derive-as <profile> Mnemonic derivation: eip155 or tron')
          io.print('  --mnemonic-index, -mi <n>  Mnemonic account index (default: 0)')
          io.print(DIR_OPT)
          io.print(HELP_OPT)
          break
        }
        if (subcommand === 'privy') {
          io.print('Usage: agent-wallet add privy [options]')
          io.print('')
          io.print('Add a Privy-backed wallet.')
          io.print('')
          io.print('Options:')
          io.print('  --wallet-id, -w <id>  Wallet ID')
          io.print(PRIVY_APP_ID_OPT)
          io.print(PRIVY_APP_SECRET_OPT)
          io.print(PRIVY_APP_SECRET_EXEC_OPT)
          io.print(PRIVY_WALLET_ID_OPT)
          io.print(DIR_OPT)
          io.print(HELP_OPT)
          break
        }
        if (subcommand === 'wallet_cli') {
          io.print('Usage: agent-wallet add wallet_cli [options]')
          io.print('')
          io.print('Add a wallet-cli managed wallet (TRON; BSC planned).')
          io.print('')
          io.print('Options:')
          io.print('  --wallet-id, -w <id>  Wallet ID')
          io.print(CLI_PASSWORD_EXEC_OPT)
          io.print(CLI_ACCOUNT_OPT)
          io.print(CLI_PASSWORD_OPT)
          io.print(DIR_OPT)
          io.print(HELP_OPT)
          break
        }
        io.print('Usage: agent-wallet add [options]')
        io.print('       agent-wallet add <raw_secret|privy|wallet_cli> [options]')
        io.print('')
        io.print('Add a new wallet.')
        io.print('')
        io.print('Options:')
        io.print('  --wallet-id, -w <id>  Wallet ID')
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        io.print('')
        io.print('Subcommands:')
        io.print('  raw_secret          Add a plaintext raw secret wallet')
        io.print('  privy               Add a Privy-backed wallet')
        io.print('  wallet_cli          Add a wallet-cli managed wallet (TRON; BSC planned)')
        break
      case 'list':
        io.print('Usage: agent-wallet list [options]')
        io.print('')
        io.print('List all configured wallets.')
        io.print('')
        io.print('Options:')
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        break
      case 'use':
        io.print('Usage: agent-wallet use [wallet-id] [options]')
        io.print('')
        io.print('Set the active wallet.')
        io.print('')
        io.print('Options:')
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        break
      case 'inspect':
        io.print('Usage: agent-wallet inspect <wallet-id> [options]')
        io.print('')
        io.print('Show wallet details.')
        io.print('')
        io.print('Options:')
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        break
      case 'resolve-address':
        io.print('Usage: agent-wallet resolve-address [wallet-id] [options]')
        io.print('')
        io.print('Resolve wallet address output for display.')
        io.print('')
        io.print('Options:')
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        break
      case 'remove':
        io.print('Usage: agent-wallet remove [wallet-id] [options]')
        io.print('')
        io.print('Remove a wallet and its associated files.')
        io.print('')
        io.print('Options:')
        io.print('  --yes, -y             Skip confirmation')
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        break
      case 'sign':
        if (subcommand === 'tx') {
          io.print('Usage: agent-wallet sign tx <payload> [options]')
          io.print('')
          io.print('Sign a transaction. Payload is a JSON string.')
        } else if (subcommand === 'typed-data') {
          io.print('Usage: agent-wallet sign typed-data <data> [options]')
          io.print('')
          io.print('Sign EIP-712 typed data. Data is a JSON string.')
        } else {
          io.print('Usage: agent-wallet sign <subcommand> <data> [options]')
          io.print('')
          io.print('Sign transactions or messages.')
          io.print('')
          io.print('Subcommands:')
          io.print('  tx <payload>        Sign a transaction (JSON)')
          io.print('  typed-data <data>   Sign EIP-712 typed data (JSON)')
          io.print('')
          io.print('Run agent-wallet sign <subcommand> --help for more info.')
          break
        }
        io.print('')
        io.print('Options:')
        io.print(WALLET_OPT)
        io.print(NETWORK_OPT)
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        break
      case 'reset':
        io.print('Usage: agent-wallet reset [options]')
        io.print('')
        io.print('Delete all wallet data.')
        io.print('')
        io.print('Options:')
        io.print('  --yes, -y             Skip confirmation')
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        break
      default:
        io.print('Usage: agent-wallet <command> [options]')
        io.print('')
        io.print('Commands:')
        io.print('  start             Quick setup: init + create wallet')
        io.print('  add               Add a new wallet')
        io.print('  list              List all configured wallets')
        io.print('  use [id]          Set the active wallet (interactive if omitted)')
        io.print('  inspect <id>      Show wallet details')
        io.print('  resolve-address <id>  Resolve wallet address output')
        io.print('  remove <id>       Remove a wallet')
        io.print('  sign tx <data>    Sign a transaction (JSON payload)')
        io.print('  sign typed-data <data>  Sign EIP-712 typed data (JSON)')
        io.print('  reset             Delete all wallet data')
        io.print('')
        io.print('Options:')
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        io.print('')
        io.print('Run agent-wallet <command> --help for more info on a command.')
        break
    }
    return 0
  }

  if (rawArgs.length === 0) {
    return showCommandHelp('', undefined, cliIO)
  }

  const { command, subcommand, args, options } = parseArgs(rawArgs)

  if (options.help === true || options.h === true) {
    return showCommandHelp(command, subcommand, cliIO)
  }

  const dir = expandTilde((options.dir ?? options.d ?? DEFAULT_DIR) as string)
  const mnemonicIndexOption = (options['mnemonic-index'] ?? options.mi) as string | undefined

  try {
    switch (command) {
      case 'start': {
        await cmdStart(dir, cliIO, {
          walletType: subcommand,
          walletId: (options['wallet-id'] ?? options.w) as string | undefined,
          generate: options.generate === true || options.g === true,
          privateKey: (options['private-key'] ?? options.k) as string | undefined,
          mnemonic: (options.mnemonic ?? options.m) as string | undefined,
          deriveAs: options['derive-as'] as string | undefined,
          mnemonicIndex: mnemonicIndexOption ? Number(mnemonicIndexOption) : undefined,
          appId: options['app-id'] as string | undefined,
          appSecret: options['app-secret'] as string | undefined,
          privyWalletId: options['privy-wallet-id'] as string | undefined,
          override: options.override === true,
          cliAccount: options.account as string | undefined,
          cliPassword: options['cli-password'] as string | undefined,
          cliPasswordExec: options['cli-password-exec'] as string | undefined,
          appSecretExec: options['app-secret-exec'] as string | undefined,
        })
        break
      }
      case 'add': {
        await cmdAdd(dir, cliIO, {
          walletType: subcommand,
          walletId: (options['wallet-id'] ?? options.w) as string | undefined,
          generate: options.generate === true || options.g === true,
          privateKey: (options['private-key'] ?? options.k) as string | undefined,
          mnemonic: (options.mnemonic ?? options.m) as string | undefined,
          deriveAs: options['derive-as'] as string | undefined,
          mnemonicIndex: mnemonicIndexOption ? Number(mnemonicIndexOption) : undefined,
          appId: options['app-id'] as string | undefined,
          appSecret: options['app-secret'] as string | undefined,
          privyWalletId: options['privy-wallet-id'] as string | undefined,
          cliAccount: options.account as string | undefined,
          cliPassword: options['cli-password'] as string | undefined,
          cliPasswordExec: options['cli-password-exec'] as string | undefined,
          appSecretExec: options['app-secret-exec'] as string | undefined,
        })
        break
      }
      case 'list':
        await cmdList(dir, cliIO)
        break
      case 'use':
        await cmdUse(subcommand ?? args[0], dir, cliIO)
        break
      case 'inspect':
        if (!subcommand && args.length === 0) {
          cliIO.print('Usage: agent-wallet inspect <wallet-id>')
          return 1
        }
        await cmdInspect(subcommand ?? args[0], dir, cliIO)
        break
      case 'resolve-address':
        await cmdResolveAddress(subcommand ?? args[0], dir, cliIO)
        break
      case 'remove':
        await cmdRemove(
          subcommand ?? args[0],
          dir,
          options.yes === true || options.y === true,
          cliIO,
        )
        break
      case 'sign':
        if (!subcommand) {
          cliIO.print('Usage: agent-wallet sign <tx|typed-data> <data> [options]')
          return 1
        }
        switch (subcommand) {
          case 'tx':
            await cmdSignTx(
              (options['wallet-id'] ?? options.w) as string,
              args[0],
              (options.network ?? options.n) as string | undefined,
              dir,
              cliIO,
            )
            break
          case 'typed-data':
            await cmdSignTypedData(
              (options['wallet-id'] ?? options.w) as string,
              args[0],
              (options.network ?? options.n) as string | undefined,
              dir,
              cliIO,
            )
            break
          default:
            cliIO.print(`Unknown sign subcommand: ${subcommand}`)
            return 1
        }
        break
      case 'reset':
        await cmdReset(dir, options.yes === true || options.y === true, cliIO)
        break
      default:
        cliIO.print(`Unknown command: ${command}`)
        return 1
    }
 } catch (e) {
   if (e instanceof CliExit) {
     return e.code
   }
    if (e instanceof WalletError) {
      cliIO.print(e.message)
      return 1
    }
   if (e instanceof Error && e.message.startsWith('Invalid wallet config in ')) {
     cliIO.print(e.message)
     return 1
   }
   throw e
 }

  return 0
}
