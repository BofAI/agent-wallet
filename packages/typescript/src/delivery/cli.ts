/**
 * AgentWallet CLI — key management and signing operations.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { WalletType } from '../core/base.js'
import {
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
import { type SecretValue } from '../core/secret-resolver.js'
import { CliExit, promptInput, selectInput, type CliIO } from './cli-io.js'
import { printWalletTable } from './cli-output.js'

// --- Helpers ---

export function getProvider(dir: string): ConfigWalletProvider {
  try {
    return new ConfigWalletProvider(dir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid wallet config in ${join(dir, WALLETS_CONFIG_FILENAME)}: ${message}`, {
      cause: error,
    })
  }
}

export function managedJsonFiles(dir: string): string[] {
  const files: string[] = []
  if (existsSync(join(dir, WALLETS_CONFIG_FILENAME))) files.push(WALLETS_CONFIG_FILENAME)
  return files
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
    privy: 'Existing Privy API-backed wallet',
    wallet_cli: 'Existing wallet-cli account (TRON + EVM signer)',
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
  if (derivationProfile !== 'eip155' && derivationProfile !== 'tron') {
    throw new Error("mnemonic derivation profile must be 'eip155' or 'tron'")
  }
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
      const params = conf.params
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
  opts: {
    account: string
    cliPassword?: string
    cliPasswordExec?: string
  },
): Promise<WalletConfig> {
  let password: SecretValue
  if (opts.cliPasswordExec) {
    password = { exec: opts.cliPasswordExec }
  } else if (opts.cliPassword) {
    password = opts.cliPassword
  } else {
    password = await promptCredential(io, 'wallet-cli keystore password')
  }

  return {
    type: 'wallet_cli',
    params: {
      account: opts.account,
      password,
    } as WalletCliWalletParams,
  }
}

/**
 * Probe wallet-cli binary availability before collecting credentials.
 * If the binary is missing, print install guidance and exit — collecting a
 * keystore password without a wallet-cli keystore would produce a useless
 * config entry.
 */
async function probeWalletCli(io: CliIO): Promise<WalletCliClient> {
  const client = new WalletCliClient()
  try {
    // Version, catalog, networks and current capability only; never acquires a password.
    await client.ensureCompatible()
    return client
  } catch (e) {
    if (e instanceof WalletCliNotFoundError) {
      io.print(
        'wallet-cli not found. Please install (npm i -g @tron-walletcli/wallet-cli) and add your account first.',
      )
      throw new CliExit(1)
    }
    io.print(`\nWarning: could not reach wallet-cli: ${(e as Error).message}`)
    throw new CliExit(1)
  }
}

async function resolveWalletCliAccount(
  io: CliIO,
  client: WalletCliClient,
  requestedAccount?: string,
): Promise<string> {
  let accountRef = requestedAccount?.trim() || undefined
  if (!accountRef && io.interactive !== false) {
    accountRef =
      (
        await promptInput(
          io,
          'Existing wallet-cli account label (optional, press Enter to use active)',
          {},
          'wallet-cli account',
        )
      ).trim() || undefined
  }

  try {
    const result = await client.currentAccount(accountRef)
    io.print(`Using existing wallet-cli account '${result.data.accountId}'.`)
    return result.data.accountId
  } catch (error) {
    const accountLabel = accountRef ? `'${accountRef}'` : '(active)'
    const reason = error instanceof WalletError ? `: ${error.message}` : ''
    io.print(`Could not link wallet-cli account ${accountLabel}${reason}`)
    io.print(
      'Create or import the account with wallet-cli, then rerun agent-wallet start/add wallet_cli.',
    )
    throw new CliExit(1)
  }
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
    const client = await probeWalletCli(io)
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
    const account = await resolveWalletCliAccount(io, client, opts?.cliAccount)
    const cliConfig = await buildWalletCliConfigWithFlags(io, {
      account,
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
    const client = await probeWalletCli(io)
    targetName = opts?.walletId ?? (await promptWalletId(io, 'default_cli', provider))
    const account = await resolveWalletCliAccount(io, client, opts?.cliAccount)
    provider.addWallet(
      targetName,
      await buildWalletCliConfigWithFlags(io, {
        account,
        cliPassword: opts?.cliPassword,
        cliPasswordExec: opts?.cliPasswordExec,
      }),
    )
  }

  io.print(`Wallet '${targetName}' added. Config updated.`)
  if (provider.getActiveId() === targetName) {
    io.print(`  Active wallet set to '${targetName}'.`)
  }
}
