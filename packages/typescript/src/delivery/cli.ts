/**
 * AgentWallet CLI — key management and signing operations.
 */

import { existsSync, mkdirSync, chmodSync, unlinkSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { randomBytes } from 'node:crypto'

import { WalletType, type Eip712Capable } from '../core/base.js'
import {
  ConfigNotFoundError,
  type LocalSecureWalletConfig,
  type RawSecretMnemonicConfig,
  type RawSecretPrivateKeyConfig,
  type RawSecretWalletConfig,
  type WalletConfig,
} from '../core/config.js'
import { RUNTIME_SECRETS_FILENAME, WALLETS_CONFIG_FILENAME } from '../core/constants.js'
import { DecryptionError, WalletError } from '../core/errors.js'
import { ConfigWalletProvider } from '../core/providers/config-provider.js'
import {
  decodePrivateKey,
  deriveKeyFromMnemonic,
  parseNetworkFamily,
} from '../core/providers/wallet-builder.js'
import { SecureKVStore } from '../local/kv-store.js'
import { loadLocalSecret } from '../local/secret-loader.js'

// --- Helpers ---

function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/')) return join(homedir(), p.slice(1))
  return p
}

const DEFAULT_DIR = expandTilde(process.env.AGENT_WALLET_DIR ?? join(homedir(), '.agent-wallet'))

export interface CliIO {
  print(msg: string): void
  prompt(
    question: string,
    opts?: { password?: boolean; choices?: string[]; defaultValue?: string },
  ): Promise<string>
  confirm(question: string, defaultValue?: boolean): Promise<boolean>
  select?(promptText: string, choices: string[]): Promise<string | null>
}

async function loadInquirer() {
  if (!process.stdin.isTTY) return null
  try {
    return await import('@inquirer/prompts')
  } catch {
    return null
  }
}

async function interactiveSelect(promptText: string, choices: string[]): Promise<string | null> {
  const inquirer = await loadInquirer()
  if (!inquirer) return null
  return inquirer.select({
    message: promptText,
    choices: choices.map((c) => ({ name: c, value: c })),
  })
}

function createConsoleIO(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): CliIO {
  return {
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

function validatePasswordStrength(password: string): string[] {
  const errors: string[] = []
  if (password.length < 8) errors.push('at least 8 characters')
  if (!/[A-Z]/.test(password)) errors.push('at least 1 uppercase letter')
  if (!/[a-z]/.test(password)) errors.push('at least 1 lowercase letter')
  if (!/[0-9]/.test(password)) errors.push('at least 1 digit')
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('at least 1 special character')
  return errors
}

function formatPasswordError(errors: string[]): string {
  return `Password too weak. Requirements: ${errors.join(', ')}.\n  Example of a strong password: MyWallet#2024`
}

async function getPassword(
  io: CliIO,
  opts?: {
    confirm?: boolean
    explicit?: string
    provider?: ConfigWalletProvider
    promptIfMissing?: boolean
  },
): Promise<string | undefined> {
  // Priority: explicit -p flag > runtime secrets > AGENT_WALLET_PASSWORD env > interactive prompt
  let pw = opts?.explicit
  if (!pw && opts?.provider) {
    try {
      pw = opts.provider.loadRuntimeSecretsPassword() ?? undefined
    } catch (error) {
      io.print(`Invalid runtime secrets: ${(error as Error).message}`)
      throw new CliExit(1)
    }
  }
  if (!pw) pw = process.env.AGENT_WALLET_PASSWORD
  if (pw) {
    if (opts?.confirm) {
      const errors = validatePasswordStrength(pw)
      if (errors.length > 0) {
        io.print(formatPasswordError(errors))
        throw new CliExit(1)
      }
    }
    return pw
  }
  if (opts?.promptIfMissing === false) {
    return undefined
  }
  pw = await io.prompt('Master password', { password: true })
  if (opts?.confirm) {
    const errors = validatePasswordStrength(pw)
    if (errors.length > 0) {
      io.print(formatPasswordError(errors))
      throw new CliExit(1)
    }
    const pw2 = await io.prompt('Confirm password', { password: true })
    if (pw !== pw2) {
      io.print('Passwords do not match.')
      throw new CliExit(1)
    }
  }
  return pw
}

function generatePassword(): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const lower = 'abcdefghijklmnopqrstuvwxyz'
  const digits = '0123456789'
  const special = '!@#$%^&*'
  const all = upper + lower + digits + special

  const pick = (charset: string, count: number): string[] => {
    const result: string[] = []
    for (let i = 0; i < count; i++) {
      result.push(charset[randomBytes(1)[0] % charset.length])
    }
    return result
  }

  const chars = [
    ...pick(upper, 3),
    ...pick(lower, 3),
    ...pick(digits, 3),
    ...pick(special, 3),
    ...pick(all, 4),
  ]

  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

function getProvider(dir: string, pw?: string): ConfigWalletProvider {
  try {
    return new ConfigWalletProvider(dir, pw ?? undefined, { secretLoader: loadLocalSecret })
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      return new ConfigWalletProvider(dir, pw ?? undefined, { secretLoader: loadLocalSecret })
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Invalid wallet config in ${join(dir, WALLETS_CONFIG_FILENAME)}: ${message}`,
      { cause: error },
    )
  }
}

function managedJsonFiles(dir: string): string[] {
  const files: string[] = []
  for (const name of ['master.json', WALLETS_CONFIG_FILENAME, RUNTIME_SECRETS_FILENAME]) {
    if (existsSync(join(dir, name))) files.push(name)
  }
  try {
    const all = readdirSync(dir).sort()
    for (const f of all) {
      if (f.startsWith('secret_') && f.endsWith('.json')) files.push(f)
    }
  } catch {
    // dir might not exist
  }
  return files
}

function maybeSaveRuntimeSecrets(
  provider: ConfigWalletProvider,
  password: string | undefined,
  save: boolean,
): void {
  if (!password || !save) return
  provider.saveRuntimeSecrets(password)
}

// --- Exit signal ---
export class CliExit extends Error {
  constructor(public code: number) {
    super(`Exit ${code}`)
    this.name = 'CliExit'
  }
}

// --- Wallet type resolution ---

async function selectWalletType(explicit: string | undefined, io: CliIO): Promise<WalletType> {
  if (explicit !== undefined) {
    if (explicit === WalletType.LOCAL_SECURE || explicit === WalletType.RAW_SECRET) {
      return explicit
    }
    io.print(
      `Unknown wallet type: ${explicit}. Use: ${Object.values(WalletType).join(', ')}`,
    )
    throw new CliExit(1)
  }
  const choices = Object.values(WalletType)
  const selected =
    (await io.select?.('Quick start type', choices)) ??
    (await io.prompt('Quick start type', { choices }))

  if (selected === WalletType.LOCAL_SECURE || selected === WalletType.RAW_SECRET) {
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
    if (!opts.allowGenerate) throw new Error('--generate is only valid for local_secure wallets.')
    return 'generate'
  }
  if (opts.privateKey) return 'private_key'
  if (opts.mnemonic) return 'mnemonic'
  throw new Error('Import source selection requires interactive resolution.')
}

async function promptWalletId(io: CliIO, defaultValue: string): Promise<string> {
  return await io.prompt('Wallet ID', { defaultValue })
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
  return (
    (await io.select?.('Import source', choices)) ??
    (await io.prompt('Import source', { choices, defaultValue: choices[0] }))
  )
}

async function promptDerivationProfile(io: CliIO): Promise<string> {
  const choices = ['eip155', 'tron']
  return (
    (await io.select?.('Derive mnemonic as', choices)) ??
    (await io.prompt('Derive mnemonic as', { choices, defaultValue: 'eip155' }))
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

  const promptedMnemonic = await io.prompt('Paste mnemonic phrase', { password: true })
  const promptedIndex = await io.prompt('Account index', {
    defaultValue: String(mnemonicIndex),
  })
  const parsedIndex = Number(promptedIndex)
  if (!Number.isInteger(parsedIndex) || parsedIndex < 0) {
    throw new Error('Invalid account index.')
  }
  return { mnemonic: promptedMnemonic.trim(), mnemonicIndex: parsedIndex }
}

async function resolvePrivateKeyInput(io: CliIO, opts: {
  generate: boolean
  privateKey?: string
  mnemonic?: string
  deriveAs?: string
  mnemonicIndex: number
  allowGenerate: boolean
}): Promise<Buffer | null> {
  const source = await selectImportSourceInteractive(io, {
    generate: opts.generate,
    privateKey: opts.privateKey,
    mnemonic: opts.mnemonic,
    allowGenerate: opts.allowGenerate,
  })
  if (source === 'generate') return null
  if (source === 'private_key') {
    const keyHex =
      opts.privateKey ?? (await io.prompt('Paste private key (hex)', { password: true }))
    return Buffer.from(decodePrivateKey(keyHex))
  }
  // mnemonic
  if (opts.mnemonicIndex && !opts.mnemonic) {
    throw new Error('--mnemonic-index requires --mnemonic.')
  }
  const { mnemonic, mnemonicIndex } = await promptMnemonicMaterial(
    io,
    opts.mnemonic,
    opts.mnemonicIndex,
  )
  const derivationProfile = opts.deriveAs ?? (await promptDerivationProfile(io))
  const network = parseNetworkFamily(derivationProfile)
  return Buffer.from(deriveKeyFromMnemonic(network, mnemonic, mnemonicIndex))
}

async function buildRawSecretConfig(io: CliIO, opts: {
  privateKey?: string
  mnemonic?: string
  mnemonicIndex: number
}): Promise<RawSecretWalletConfig> {
  const source = await selectImportSourceInteractive(io, {
    generate: false,
    privateKey: opts.privateKey,
    mnemonic: opts.mnemonic,
    allowGenerate: false,
  })

  if (source === 'private_key') {
    const keyHex =
      opts.privateKey ?? (await io.prompt('Paste private key (hex)', { password: true }))
    const normalized = '0x' + Buffer.from(decodePrivateKey(keyHex)).toString('hex')
    return {
      type: 'raw_secret',
      material: { source: 'private_key', private_key: normalized } as RawSecretPrivateKeyConfig,
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
  return {
    type: 'raw_secret',
    material: {
      source: 'mnemonic',
      mnemonic,
      account_index: mnemonicIndex,
    } as RawSecretMnemonicConfig,
  }
}

// --- Commands ---

export async function cmdInit(
  dir: string,
  io: CliIO,
  opts?: { password?: string; saveRuntimeSecrets?: boolean },
): Promise<void> {
  const masterPath = join(dir, 'master.json')
  if (existsSync(masterPath)) {
    io.print(`Already initialized: ${dir}`)
    throw new CliExit(1)
  }

  mkdirSync(dir, { recursive: true })
  try {
    chmodSync(dir, 0o700)
  } catch {
    /* ignore */
  }

  const provider = getProvider(dir)
  const pw = await getPassword(io, { confirm: true, explicit: opts?.password, provider })
  if (!pw) throw new CliExit(1)
  const kvStore = new SecureKVStore(dir, pw)
  kvStore.initMaster()
  provider.ensureStorage()
  maybeSaveRuntimeSecrets(getProvider(dir, pw), pw, opts?.saveRuntimeSecrets ?? false)

  io.print(`Initialized. Secrets directory: ${dir}`)
}

export async function cmdStart(
  dir: string,
  io: CliIO,
  opts?: {
    walletType?: string
    walletId?: string
    password?: string
    generate?: boolean
    privateKey?: string
    mnemonic?: string
    deriveAs?: string
    mnemonicIndex?: number
    saveRuntimeSecrets?: boolean
  },
): Promise<void> {
  const wtype = await selectWalletType(opts?.walletType, io)
  let provider: ConfigWalletProvider
  let autoGenerated = false

  if (wtype === WalletType.LOCAL_SECURE) {
    const targetName = opts?.walletId ?? (await promptWalletId(io, 'default'))
    provider = getProvider(dir)
    let pw: string
    let kvStore: SecureKVStore

    if (existsSync(join(dir, 'master.json'))) {
      const resolvedPassword = await getPassword(io, { explicit: opts?.password, provider })
      if (!resolvedPassword) throw new CliExit(1)
      pw = resolvedPassword
      kvStore = new SecureKVStore(dir, pw)
      try {
        kvStore.verifyPassword()
      } catch (e) {
        if (e instanceof DecryptionError) {
          io.print('Wrong password. Please try again.')
          throw new CliExit(1)
        }
        throw e
      }
      io.print('\nWallet already initialized.')
    } else {
      const explicitPw = opts?.password ?? process.env.AGENT_WALLET_PASSWORD
      if (explicitPw) {
        const errors = validatePasswordStrength(explicitPw)
        if (errors.length > 0) {
          io.print(formatPasswordError(errors))
          throw new CliExit(1)
        }
        pw = explicitPw
      } else {
        pw = generatePassword()
        autoGenerated = true
      }

      mkdirSync(dir, { recursive: true })
      try {
        chmodSync(dir, 0o700)
      } catch {
        /* ignore */
      }
      kvStore = new SecureKVStore(dir, pw)
      kvStore.initMaster()
      provider.ensureStorage()
      io.print('\nWallet initialized!')
    }

    maybeSaveRuntimeSecrets(getProvider(dir, pw), pw, opts?.saveRuntimeSecrets ?? false)

    const secret = await resolvePrivateKeyInput(io, {
      generate: opts?.generate ?? false,
      privateKey: opts?.privateKey,
      mnemonic: opts?.mnemonic,
      deriveAs: opts?.deriveAs,
      mnemonicIndex: opts?.mnemonicIndex ?? 0,
      allowGenerate: true,
    })

    const rows: [string, string][] = []
    try {
      const c = provider.getWalletConfig(targetName)
      rows.push([targetName, c.type])
    } catch {
      if (secret === null) {
        kvStore.generateSecret(targetName)
      } else {
        kvStore.saveSecret(targetName, secret)
      }
      provider.addWallet(targetName, {
        type: 'local_secure',
        secret_ref: targetName,
      } as LocalSecureWalletConfig)
      provider.setActive(targetName)
      rows.push([targetName, 'local_secure'])
    }

    io.print('\nWallets:')
    printWalletTable(io, rows)

    if (autoGenerated) {
      io.print(`\nYour master password: ${pw}`)
      io.print("   Save this password! You'll need it for signing and other operations.")
    }
  } else if (wtype === WalletType.RAW_SECRET) {
    if (opts?.password) {
      io.print('--password is only valid for local_secure quick start.')
      throw new CliExit(1)
    }
    io.print('Warning: Raw secret material will be stored in plaintext in wallets_config.json.')
    const targetName = opts?.walletId ?? (await promptWalletId(io, 'raw_wallet'))

    const rawConfig = await buildRawSecretConfig(io, {
      privateKey: opts?.privateKey,
      mnemonic: opts?.mnemonic,
      mnemonicIndex: opts?.mnemonicIndex ?? 0,
    })

    provider = getProvider(dir)
    provider.ensureStorage()
    try {
      provider.addWallet(targetName, rawConfig)
      provider.setActive(targetName)
    } catch (e) {
      io.print(`Error: ${(e as Error).message}`)
      throw new CliExit(1)
    }

    io.print(`\nWallet '${targetName}' created:`)
    printWalletTable(io, [[targetName, 'raw_secret']])
  } else {
    io.print(`Unsupported quick-start type: ${wtype}`)
    throw new CliExit(1)
  }

  io.print(`\nActive wallet: ${provider!.getActiveId()}`)
  io.print('\nQuick guide:')
  io.print("   agent-wallet list              -- View your wallets")
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
    password?: string
    generate?: boolean
    privateKey?: string
    mnemonic?: string
    deriveAs?: string
    mnemonicIndex?: number
    saveRuntimeSecrets?: boolean
  },
): Promise<void> {
  const wtype = await selectWalletType(opts?.walletType, io)
  const provider = getProvider(dir)

  if (!provider.isInitialized()) {
    io.print("Wallet not initialized. Run 'agent-wallet start' or 'agent-wallet init' first.")
    throw new CliExit(1)
  }

  const targetName = opts?.walletId ?? (await promptWalletId(io, 'wallet'))
  try {
    provider.getWalletConfig(targetName)
    io.print(`Wallet '${targetName}' already exists.`)
    throw new CliExit(1)
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes('not found')) throw e
  }

  if (wtype === WalletType.LOCAL_SECURE) {
    const pw = await getPassword(io, { explicit: opts?.password, provider })
    if (!pw) throw new CliExit(1)
    const secureProvider = getProvider(dir, pw)
    maybeSaveRuntimeSecrets(secureProvider, pw, opts?.saveRuntimeSecrets ?? false)
    const kvStore = new SecureKVStore(dir, pw)
    try {
      kvStore.verifyPassword()
    } catch (e) {
      if (e instanceof DecryptionError) {
        io.print('Wrong password. Please try again.')
        throw new CliExit(1)
      }
      throw e
    }

    const secret = await resolvePrivateKeyInput(io, {
      generate: opts?.generate ?? false,
      privateKey: opts?.privateKey,
      mnemonic: opts?.mnemonic,
      deriveAs: opts?.deriveAs,
      mnemonicIndex: opts?.mnemonicIndex ?? 0,
      allowGenerate: true,
    })

    if (secret === null) {
      kvStore.generateSecret(targetName)
      io.print('Generated new private key.')
    } else {
      kvStore.saveSecret(targetName, secret)
      io.print('Imported secret material.')
    }

    provider.addWallet(targetName, {
      type: 'local_secure',
      secret_ref: targetName,
    } as LocalSecureWalletConfig)
    io.print(`  Saved:   secret_${targetName}.json`)
  } else if (wtype === WalletType.RAW_SECRET) {
    if (opts?.password) {
      io.print('--password is only valid for local_secure wallets.')
      throw new CliExit(1)
    }
    io.print('Warning: Raw secret material will be stored in plaintext in wallets_config.json.')
    provider.addWallet(
      targetName,
      await buildRawSecretConfig(io, {
        privateKey: opts?.privateKey,
        mnemonic: opts?.mnemonic,
        mnemonicIndex: opts?.mnemonicIndex ?? 0,
      }),
    )
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

  const c1 = 20
  const c2 = 15
  const hr = (l: string, m: string, r: string) =>
    `${l}${'─'.repeat(c1 + 2)}${m}${'─'.repeat(c2 + 2)}${r}`
  io.print('Wallets:')
  io.print(hr('┌', '┬', '┐'))
  io.print(`│ ${'Wallet ID'.padEnd(c1)} │ ${'Type'.padEnd(c2)} │`)
  io.print(hr('├', '┼', '┤'))

  for (const [wid, conf, isActive] of rows) {
    const marker = isActive ? '* ' : '  '
    io.print(`│${marker}${wid.padEnd(c1)} │ ${conf.type.padEnd(c2)} │`)
  }
  io.print(hr('└', '┴', '┘'))
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

  io.print(`Wallet      ${walletId}`)
  io.print(`Type        ${conf.type}`)

  if (conf.type === 'local_secure') {
    const secretStatus = provider.hasSecretFile(walletId) ? '\u2713' : '\u2014'
    io.print(`Secret      secret_${conf.secret_ref}.json ${secretStatus}`)
  } else if (conf.type === 'raw_secret') {
    io.print(`Source Type ${conf.material.source}`)
    if (conf.material.source === 'private_key') {
      io.print('Private Key [redacted]')
    } else if (conf.material.source === 'mnemonic') {
      io.print('Mnemonic    [redacted]')
      io.print(`Account Index ${conf.material.account_index}`)
    }
  }
}

export async function cmdRemove(
  walletId: string,
  dir: string,
  yes: boolean,
  io: CliIO,
): Promise<void> {
  const provider = getProvider(dir)
  let conf: WalletConfig
  try {
    conf = provider.getWalletConfig(walletId)
  } catch {
    io.print(`Wallet '${walletId}' not found.`)
    throw new CliExit(1)
  }

  if (!yes) {
    const confirmed = await io.confirm(`Remove wallet '${walletId}'?`, false)
    if (!confirmed) {
      io.print('Cancelled.')
      throw new CliExit(0)
    }
  }

  if (conf.type === 'local_secure' && provider.hasSecretFile(walletId)) {
    io.print(`  Deleted: secret_${conf.secret_ref}.json`)
  }
  provider.removeWallet(walletId)
  io.print(`Wallet '${walletId}' removed.`)
}

export async function cmdUse(walletId: string, dir: string, io: CliIO): Promise<void> {
  const provider = getProvider(dir)
  try {
    const conf = provider.setActive(walletId)
    io.print(`Active wallet: ${walletId} (${conf.type})`)
  } catch {
    io.print(`Wallet '${walletId}' not found.`)
    throw new CliExit(1)
  }
}

function resolveWalletId(explicit: string | undefined, dir: string, io: CliIO): string {
  if (explicit) return explicit
  const provider = getProvider(dir)
  if (!provider.isInitialized()) {
    io.print("Wallet config not initialized. Run 'agent-wallet start' first, or 'agent-wallet init' for local_secure setup.")
    throw new CliExit(1)
  }
  const activeId = provider.getActiveId()
  if (activeId) return activeId
  io.print(
    "No wallet specified and no active wallet set. Use '--wallet-id <id>' or 'agent-wallet use <id>'.",
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
  opts?: { password?: string; saveRuntimeSecrets?: boolean },
): Promise<void> {
  if (!network) {
    io.print('--network is required for sign commands.')
    throw new CliExit(1)
  }
  const walletId = resolveWalletId(wallet, dir, io)
  const baseProvider = getProvider(dir)
  const pw = await getPassword(io, { explicit: opts?.password, provider: baseProvider, promptIfMissing: false })
  const provider = getProvider(dir, pw)
  maybeSaveRuntimeSecrets(provider, pw, opts?.saveRuntimeSecrets ?? false)

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
    if (e instanceof DecryptionError) {
      io.print('Wrong password. Please try again.')
      throw new CliExit(1)
    }
    if (e instanceof WalletError || e instanceof SyntaxError) {
      io.print(`Error: ${(e as Error).message}`)
      throw new CliExit(1)
    }
    throw e
  }
}

export async function cmdSignMsg(
  wallet: string | undefined,
  message: string,
  network: string | undefined,
  dir: string,
  io: CliIO,
  opts?: { password?: string; saveRuntimeSecrets?: boolean },
): Promise<void> {
  if (!network) {
    io.print('--network is required for sign commands.')
    throw new CliExit(1)
  }
  const walletId = resolveWalletId(wallet, dir, io)
  const baseProvider = getProvider(dir)
  const pw = await getPassword(io, { explicit: opts?.password, provider: baseProvider, promptIfMissing: false })
  const provider = getProvider(dir, pw)
  maybeSaveRuntimeSecrets(provider, pw, opts?.saveRuntimeSecrets ?? false)

  try {
    const w = await provider.getWallet(walletId, network)
    const signature = await w.signMessage(Buffer.from(message, 'utf-8'))
    io.print(`Signature: ${signature}`)
  } catch (e) {
    if (e instanceof DecryptionError) {
      io.print('Wrong password. Please try again.')
      throw new CliExit(1)
    }
    if (e instanceof WalletError) {
      io.print(`Error: ${e.message}`)
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
  opts?: { password?: string; saveRuntimeSecrets?: boolean },
): Promise<void> {
  if (!network) {
    io.print('--network is required for sign commands.')
    throw new CliExit(1)
  }
  const walletId = resolveWalletId(wallet, dir, io)
  const baseProvider = getProvider(dir)
  const pw = await getPassword(io, { explicit: opts?.password, provider: baseProvider, promptIfMissing: false })
  const provider = getProvider(dir, pw)
  maybeSaveRuntimeSecrets(provider, pw, opts?.saveRuntimeSecrets ?? false)

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
    if (e instanceof DecryptionError) {
      io.print('Wrong password. Please try again.')
      throw new CliExit(1)
    }
    if (e instanceof WalletError || e instanceof SyntaxError) {
      io.print(`Error: ${(e as Error).message}`)
      throw new CliExit(1)
    }
    throw e
  }
}

export async function cmdChangePassword(
  dir: string,
  io: CliIO,
  opts?: { password?: string; saveRuntimeSecrets?: boolean },
): Promise<void> {
  const baseProvider = getProvider(dir)
  const oldPw =
    opts?.password ??
    baseProvider.loadRuntimeSecretsPassword() ??
    process.env.AGENT_WALLET_PASSWORD ??
    (await io.prompt('Current password', { password: true }))

  const kvStoreOld = new SecureKVStore(dir, oldPw)
  try {
    kvStoreOld.verifyPassword()
  } catch (e) {
    if (e instanceof DecryptionError || e instanceof Error) {
      io.print(`Error: ${e.message}`)
      throw new CliExit(1)
    }
    throw e
  }

  const newPw = await io.prompt('New password', { password: true })
  const strengthErrors = validatePasswordStrength(newPw)
  if (strengthErrors.length > 0) {
    io.print(`Password too weak. Requirements: ${strengthErrors.join(', ')}.`)
    throw new CliExit(1)
  }
  const newPw2 = await io.prompt('Confirm new password', { password: true })
  if (newPw !== newPw2) {
    io.print('Passwords do not match.')
    throw new CliExit(1)
  }

  const kvStoreNew = new SecureKVStore(dir, newPw)
  let reEncrypted = 0

  kvStoreNew.initMaster()
  io.print('  \u2713 master.json')
  reEncrypted += 1

  const files = readdirSync(dir).sort()
  for (const file of files) {
    if (file.startsWith('secret_') && file.endsWith('.json')) {
      const name = file.slice(7, -5) // strip "secret_" and ".json"
      const secret = kvStoreOld.loadSecret(name)
      kvStoreNew.saveSecret(name, secret)
      io.print(`  \u2713 ${file}`)
      reEncrypted += 1
    }
  }

  for (const file of files) {
    if (file.startsWith('cred_') && file.endsWith('.json')) {
      const name = file.slice(5, -5)
      const cred = kvStoreOld.loadCredential(name)
      kvStoreNew.saveCredential(name, cred)
      io.print(`  \u2713 ${file}`)
      reEncrypted += 1
    }
  }

  io.print(`\nPassword changed. Re-encrypted ${reEncrypted} files.`)

  const newProvider = getProvider(dir, newPw)
  if ((opts?.saveRuntimeSecrets ?? false) || newProvider.hasRuntimeSecrets()) {
    newProvider.saveRuntimeSecrets(newPw)
  }
}

// --- Helpers (output) ---

function printWalletTable(io: CliIO, rows: [string, string][]): void {
  const c1 = 20
  const c2 = 15
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

// --- Reset Command ---

export async function cmdReset(dir: string, yes: boolean, io: CliIO): Promise<void> {
  if (!existsSync(join(dir, 'master.json'))) {
    io.print('No wallet data found in: ' + dir)
    throw new CliExit(1)
  }

  const files = managedJsonFiles(dir)
  io.print(`This will delete ALL wallet data in: ${dir}`)
  io.print(`   ${files.length} file(s): ${files.join(', ')}`)
  io.print('')

  if (!yes) {
    const confirmed = await io.confirm('Are you sure you want to reset? This cannot be undone.', false)
    if (!confirmed) {
      io.print('Cancelled.')
      throw new CliExit(0)
    }
    const confirmed2 = await io.confirm('Really delete everything? Last chance!', false)
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
  const PW_OPT = '  --password, -p <pw>   Master password (skip interactive prompt)'
  const HELP_OPT = '  --help, -h            Show this help message'
  const WALLET_OPT = '  --wallet-id, -w <id>  Wallet ID (uses active wallet if omitted)'
  const NETWORK_OPT = '  --network, -n <net>   Target network (e.g. eip155:1, tron:nile)'
  const SAVE_RS_OPT = '  --save-runtime-secrets  Persist password to runtime secrets'

  const showCommandHelp = (command: string, subcommand: string | undefined, io: CliIO): 0 => {
    switch (command) {
      case 'start':
        io.print('Usage: agent-wallet start <wallet_type> [options]')
        io.print('')
        io.print('Quick setup: initialize and create default wallets.')
        io.print('')
        io.print('Arguments:')
        io.print('  wallet_type           local_secure or raw_secret')
        io.print('')
        io.print('Options:')
        io.print('  --wallet-id, -w <id>  Wallet ID (default: "default" for local_secure)')
        io.print('  --generate, -g        Generate a new private key')
        io.print('  --private-key, -k <key>  Import from private key')
        io.print('  --mnemonic, -m <phrase>  Import from mnemonic')
        io.print('  --derive-as <profile> Mnemonic derivation: eip155 or tron')
        io.print('  --mnemonic-index <n>  Mnemonic account index (default: 0)')
        io.print('  --password, -p <pw>   Master password (auto-generated if omitted)')
        io.print(SAVE_RS_OPT)
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        break
      case 'init':
        io.print('Usage: agent-wallet init [options]')
        io.print('')
        io.print('Initialize secrets directory and set master password.')
        io.print('')
        io.print('Options:')
        io.print(PW_OPT)
        io.print(SAVE_RS_OPT)
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        break
      case 'add':
        io.print('Usage: agent-wallet add <wallet_type> [options]')
        io.print('')
        io.print('Add a new wallet.')
        io.print('')
        io.print('Arguments:')
        io.print('  wallet_type           local_secure or raw_secret')
        io.print('')
        io.print('Options:')
        io.print('  --wallet-id, -w <id>  Wallet ID')
        io.print('  --generate, -g        Generate a new private key')
        io.print('  --private-key, -k <key>  Import from private key')
        io.print('  --mnemonic, -m <phrase>  Import from mnemonic')
        io.print('  --derive-as <profile> Mnemonic derivation: eip155 or tron')
        io.print('  --mnemonic-index <n>  Mnemonic account index (default: 0)')
        io.print(PW_OPT)
        io.print(SAVE_RS_OPT)
        io.print(DIR_OPT)
        io.print(HELP_OPT)
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
        io.print('Usage: agent-wallet use <wallet-id> [options]')
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
      case 'remove':
        io.print('Usage: agent-wallet remove <wallet-id> [options]')
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
        } else if (subcommand === 'msg') {
          io.print('Usage: agent-wallet sign msg <message> [options]')
          io.print('')
          io.print('Sign a message.')
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
          io.print('  msg <message>       Sign a message')
          io.print('  typed-data <data>   Sign EIP-712 typed data (JSON)')
          io.print('')
          io.print('Run agent-wallet sign <subcommand> --help for more info.')
          break
        }
        io.print('')
        io.print('Options:')
        io.print(WALLET_OPT)
        io.print(NETWORK_OPT)
        io.print(PW_OPT)
        io.print(SAVE_RS_OPT)
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        break
      case 'change-password':
        io.print('Usage: agent-wallet change-password [options]')
        io.print('')
        io.print('Change master password and re-encrypt all files.')
        io.print('')
        io.print('Options:')
        io.print('  --password, -p <pw>   Current master password (skip prompt)')
        io.print(SAVE_RS_OPT)
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
        io.print('  start <type>      Quick setup: init + create wallet (local_secure or raw_secret)')
        io.print('  init              Initialize secrets directory and set master password')
        io.print('  add <type>        Add a new wallet (local_secure or raw_secret)')
        io.print('  list              List all configured wallets')
        io.print('  use <id>          Set the active wallet')
        io.print('  inspect <id>      Show wallet details')
        io.print('  remove <id>       Remove a wallet')
        io.print('  sign tx <data>    Sign a transaction (JSON payload)')
        io.print('  sign msg <data>   Sign a message')
        io.print('  sign typed-data <data>  Sign EIP-712 typed data (JSON)')
        io.print('  change-password   Change master password')
        io.print('  reset             Delete all wallet data')
        io.print('')
        io.print('Options:')
        io.print(PW_OPT)
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
  const password = (options.password ?? options.p) as string | undefined
  const saveRuntimeSecrets = options['save-runtime-secrets'] === true
  const mnemonicIndexOption = (options['mnemonic-index'] ?? options.mi) as string | undefined

  try {
    switch (command) {
      case 'start': {
        await cmdStart(dir, cliIO, {
          walletType: subcommand,
          walletId: (options['wallet-id'] ?? options.w) as string | undefined,
          password,
          generate: options.generate === true || options.g === true,
          privateKey: (options['private-key'] ?? options.k) as string | undefined,
          mnemonic: (options.mnemonic ?? options.m) as string | undefined,
          deriveAs: options['derive-as'] as string | undefined,
          mnemonicIndex: mnemonicIndexOption ? Number(mnemonicIndexOption) : undefined,
          saveRuntimeSecrets,
        })
        break
      }
      case 'init':
        await cmdInit(dir, cliIO, { password, saveRuntimeSecrets })
        break
      case 'add': {
        await cmdAdd(dir, cliIO, {
          walletType: subcommand,
          walletId: (options['wallet-id'] ?? options.w) as string | undefined,
          password,
          generate: options.generate === true || options.g === true,
          privateKey: (options['private-key'] ?? options.k) as string | undefined,
          mnemonic: (options.mnemonic ?? options.m) as string | undefined,
          deriveAs: options['derive-as'] as string | undefined,
          mnemonicIndex: mnemonicIndexOption ? Number(mnemonicIndexOption) : undefined,
          saveRuntimeSecrets,
        })
        break
      }
      case 'list':
        await cmdList(dir, cliIO)
        break
      case 'use':
        if (!subcommand && args.length === 0) {
          cliIO.print('Usage: agent-wallet use <wallet-id>')
          return 1
        }
        await cmdUse(subcommand ?? args[0], dir, cliIO)
        break
      case 'inspect':
        if (!subcommand && args.length === 0) {
          cliIO.print('Usage: agent-wallet inspect <wallet-id>')
          return 1
        }
        await cmdInspect(subcommand ?? args[0], dir, cliIO)
        break
      case 'remove':
        if (!subcommand && args.length === 0) {
          cliIO.print('Usage: agent-wallet remove <wallet-id>')
          return 1
        }
        await cmdRemove(
          subcommand ?? args[0],
          dir,
          options.yes === true || options.y === true,
          cliIO,
        )
        break
      case 'sign':
        if (!subcommand) {
          cliIO.print('Usage: agent-wallet sign <tx|msg|typed-data> <data> [options]')
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
              { password, saveRuntimeSecrets },
            )
            break
          case 'msg':
            await cmdSignMsg(
              (options['wallet-id'] ?? options.w) as string,
              args[0],
              (options.network ?? options.n) as string | undefined,
              dir,
              cliIO,
              { password, saveRuntimeSecrets },
            )
            break
          case 'typed-data':
            await cmdSignTypedData(
              (options['wallet-id'] ?? options.w) as string,
              args[0],
              (options.network ?? options.n) as string | undefined,
              dir,
              cliIO,
              { password, saveRuntimeSecrets },
            )
            break
          default:
            cliIO.print(`Unknown sign subcommand: ${subcommand}`)
            return 1
        }
        break
      case 'change-password':
        await cmdChangePassword(dir, cliIO, { password, saveRuntimeSecrets })
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
    if (e instanceof Error && e.message.startsWith('Invalid wallet config in ')) {
      cliIO.print(e.message)
      return 1
    }
    throw e
  }

  return 0
}
