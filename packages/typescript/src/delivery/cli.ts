/**
 * AgentWallet CLI — key management and signing operations.
 */

import { existsSync, mkdirSync, chmodSync, unlinkSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { randomBytes } from 'node:crypto'

import { privateKeyToAccount } from 'viem/accounts'
import bs58check from 'bs58check'

import { WalletType, type Eip712Capable } from '../core/base.js'
import { type WalletConfig, type WalletsTopology, loadConfig, saveConfig } from '../local/config.js'
import { SecureKVStore } from '../local/kv-store.js'
import { DecryptionError, WalletError } from '../core/errors.js'
import { WalletFactory } from '../core/provider.js'

// --- Helpers ---

function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/')) return join(homedir(), p.slice(1))
  return p
}

const DEFAULT_DIR = expandTilde(process.env.AGENT_WALLET_DIR ?? join(homedir(), '.agent-wallet'))

export interface CliIO {
  print(msg: string): void
  prompt(question: string, opts?: { password?: boolean; choices?: string[]; defaultValue?: string }): Promise<string>
  confirm(question: string, defaultValue?: boolean): Promise<boolean>
  /** Arrow-key select menu. Returns null if unavailable (non-TTY). */
  select?(promptText: string, choices: string[]): Promise<string | null>
}

/**
 * Try to load @inquirer/prompts for interactive TTY menus.
 * Returns null if not in a TTY or the package is unavailable.
 */
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

function createConsoleIO(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): CliIO {
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

async function getPassword(io: CliIO, opts?: { confirm?: boolean; explicit?: string }): Promise<string> {
  // Priority: explicit -p flag > AGENT_WALLET_PASSWORD env > interactive prompt
  if (opts?.explicit) {
    if (opts.confirm) {
      const errors = validatePasswordStrength(opts.explicit)
      if (errors.length > 0) {
        io.print(formatPasswordError(errors))
        throw new CliExit(1)
      }
    }
    return opts.explicit
  }
  const envPw = process.env.AGENT_WALLET_PASSWORD
  if (envPw) {
    if (opts?.confirm) {
      const errors = validatePasswordStrength(envPw)
      if (errors.length > 0) {
        io.print(formatPasswordError(errors))
        throw new CliExit(1)
      }
    }
    return envPw
  }
  const pw = await io.prompt('Master password', { password: true })
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

  // Ensure at least 3 of each category, then fill to 16
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

function loadConfigSafe(secretsDir: string): WalletsTopology {
  try {
    return loadConfig(secretsDir)
  } catch {
    return { config_version: 1, wallets: {}, active_wallet: null }
  }
}

function deriveAddress(walletType: string, privateKey: Buffer): string {
  const hex = `0x${privateKey.toString('hex')}` as `0x${string}`
  const account = privateKeyToAccount(hex)

  if (walletType === WalletType.EVM_LOCAL) {
    return account.address
  }
  if (walletType === WalletType.TRON_LOCAL) {
    const ethAddrBytes = Buffer.from(account.address.slice(2), 'hex')
    const tronAddrBytes = Buffer.concat([Buffer.from([0x41]), ethAddrBytes])
    return bs58check.encode(tronAddrBytes)
  }
  return ''
}

// --- Exit signal ---
export class CliExit extends Error {
  constructor(public code: number) {
    super(`Exit ${code}`)
    this.name = 'CliExit'
  }
}

// --- Commands ---

export async function cmdInit(dir: string, io: CliIO, opts?: { password?: string }): Promise<void> {
  const masterPath = join(dir, 'master.json')
  if (existsSync(masterPath)) {
    io.print(`Already initialized: ${dir}`)
    throw new CliExit(1)
  }

  mkdirSync(dir, { recursive: true })
  try {
    chmodSync(dir, 0o700)
  } catch {
    /* ignore on platforms without chmod support */
  }

  const pw = await getPassword(io, { confirm: true, explicit: opts?.password })
  const kvStore = new SecureKVStore(dir, pw)
  kvStore.initMaster()
  saveConfig(dir, { config_version: 1, wallets: {}, active_wallet: null })

  io.print(`Initialized. Secrets directory: ${dir}`)
}

export async function cmdAdd(dir: string, io: CliIO, opts?: { password?: string }): Promise<void> {
  const pw = await getPassword(io, { explicit: opts?.password })
  const kvStore = new SecureKVStore(dir, pw)
  try {
    kvStore.verifyPassword()
  } catch (e) {
    if (e instanceof DecryptionError) {
      io.print('❌ Wrong password. Please try again.')
      throw new CliExit(1)
    }
    if (e instanceof Error) {
      io.print(`Error: ${e.message}`)
      throw new CliExit(1)
    }
    throw e
  }

  const config = loadConfigSafe(dir)

  const name = await io.prompt('Wallet name')
  if (config.wallets[name]) {
    io.print(`Wallet '${name}' already exists.`)
    throw new CliExit(1)
  }

  const typeChoices = Object.values(WalletType) as string[]
  const selectFn = io.select ?? (async () => null)
  let typeStr = await selectFn('Wallet type:', typeChoices)
  if (typeStr === null) {
    typeStr = await io.prompt('Wallet type', { choices: typeChoices })
  }
  if (!typeChoices.includes(typeStr)) {
    io.print(`Invalid wallet type: ${typeStr}`)
    throw new CliExit(1)
  }
  const walletType = typeStr as WalletType

  const walletConf: Record<string, unknown> = { type: walletType }

  if (walletType === WalletType.EVM_LOCAL || walletType === WalletType.TRON_LOCAL) {
    // Private key: generate or import
    let action = await selectFn('Private key:', ['generate', 'import'])
    if (action === null) {
      action = await io.prompt('Private key', { choices: ['generate', 'import'], defaultValue: 'generate' })
    }

    const identityFile = name
    let privateKey: Buffer

    if (action === 'generate') {
      privateKey = kvStore.generateKey(identityFile)
      io.print('Generated new private key.')
    } else {
      const keyHex = await io.prompt('Paste private key (hex)', { password: true })
      const cleaned = keyHex.trim().replace(/^0x/, '')
      try {
        privateKey = Buffer.from(cleaned, 'hex')
      } catch {
        io.print('Invalid hex string.')
        throw new CliExit(1)
      }
      kvStore.savePrivateKey(identityFile, privateKey)
      io.print('Imported private key.')
    }

    walletConf.identity_file = identityFile

    const address = deriveAddress(walletType, privateKey)
    walletConf.address = address
    io.print(`  Address: ${address}`)
    io.print(`  Saved:   id_${identityFile}.json`)
  } else {
    io.print(`Wallet type '${walletType}' is not yet fully supported.`)
    throw new CliExit(1)
  }

  // Auto-set as active if no active wallet exists
  if (!config.active_wallet) {
    config.active_wallet = name
  }

  config.wallets[name] = walletConf as unknown as WalletConfig
  saveConfig(dir, config)
  io.print(`Wallet '${name}' added. Config updated.`)
  if (config.active_wallet === name) {
    io.print(`  Active wallet set to '${name}'.`)
  }
}

export async function cmdList(dir: string, io: CliIO): Promise<void> {
  const config = loadConfigSafe(dir)

  if (Object.keys(config.wallets).length === 0) {
    io.print('No wallets configured.')
    return
  }

  const c1 = 20, c2 = 15, c3 = 44
  const hr = (l: string, m: string, r: string) => `${l}${'─'.repeat(c1 + 2)}${m}${'─'.repeat(c2 + 2)}${m}${'─'.repeat(c3 + 2)}${r}`
  io.print('Wallets:')
  io.print(hr('┌', '┬', '┐'))
  io.print(`│ ${'Wallet ID'.padEnd(c1)} │ ${'Type'.padEnd(c2)} │ ${'Address'.padEnd(c3)} │`)
  io.print(hr('├', '┼', '┤'))

  for (const [wid, conf] of Object.entries(config.wallets)) {
    const marker = wid === config.active_wallet ? '* ' : '  '
    io.print(`│${marker}${wid.padEnd(c1)} │ ${(conf.type as string).padEnd(c2)} │ ${(conf.address ?? '—').padEnd(c3)} │`)
  }
  io.print(hr('└', '┴', '┘'))
}

export async function cmdInspect(walletId: string, dir: string, io: CliIO): Promise<void> {
  const config = loadConfigSafe(dir)
  if (!config.wallets[walletId]) {
    io.print(`Wallet '${walletId}' not found.`)
    throw new CliExit(1)
  }

  const conf = config.wallets[walletId]
  const idStatus = conf.identity_file && existsSync(join(dir, `id_${conf.identity_file}.json`)) ? '\u2713' : '\u2014'
  const credStatus = conf.cred_file && existsSync(join(dir, `cred_${conf.cred_file}.json`)) ? '\u2713' : '\u2014'

  io.print(`Wallet      ${walletId}`)
  io.print(`Type        ${conf.type}`)
  io.print(`Address     ${conf.address ?? '\u2014'}`)
  io.print(`Identity    ${conf.identity_file ? `id_${conf.identity_file}.json ${idStatus}` : '\u2014'}`)
  io.print(`Credential  ${conf.cred_file ? `cred_${conf.cred_file}.json ${credStatus}` : '\u2014'}`)
}

export async function cmdRemove(walletId: string, dir: string, yes: boolean, io: CliIO): Promise<void> {
  const config = loadConfigSafe(dir)
  if (!config.wallets[walletId]) {
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

  const conf = config.wallets[walletId]

  if (conf.identity_file) {
    const idPath = join(dir, `id_${conf.identity_file}.json`)
    if (existsSync(idPath)) {
      unlinkSync(idPath)
      io.print(`  Deleted: id_${conf.identity_file}.json`)
    }
  }

  if (conf.cred_file) {
    const credPath = join(dir, `cred_${conf.cred_file}.json`)
    if (existsSync(credPath)) {
      unlinkSync(credPath)
      io.print(`  Deleted: cred_${conf.cred_file}.json`)
    }
  }

  if (config.active_wallet === walletId) {
    config.active_wallet = null
  }

  delete config.wallets[walletId]
  saveConfig(dir, config)
  io.print(`Wallet '${walletId}' removed.`)
}

export async function cmdUse(walletId: string, dir: string, io: CliIO): Promise<void> {
  const config = loadConfigSafe(dir)
  if (!config.wallets[walletId]) {
    io.print(`Wallet '${walletId}' not found.`)
    throw new CliExit(1)
  }

  config.active_wallet = walletId
  saveConfig(dir, config)
  io.print(`Active wallet: ${walletId} (${config.wallets[walletId].type})`)
}

function resolveWalletId(explicit: string | undefined, dir: string, io: CliIO): string {
  if (explicit) return explicit
  let config: WalletsTopology
  try {
    config = loadConfig(dir)
  } catch {
    io.print("Wallet not initialized. Run 'agent-wallet init' first.")
    throw new CliExit(1)
  }
  if (config.active_wallet) return config.active_wallet
  io.print("No wallet specified and no active wallet set. Use '--wallet <id>' or 'agent-wallet use <id>'.")
  throw new CliExit(1)
}

// --- Sign subcommands ---

export async function cmdSignTx(wallet: string | undefined, payload: string, dir: string, io: CliIO, opts?: { password?: string }): Promise<void> {
  const walletId = resolveWalletId(wallet, dir, io)
  const pw = await getPassword(io, { explicit: opts?.password })

  try {
    const provider = WalletFactory({ secretsDir: dir, password: pw })
    const w = await provider.getWallet(walletId)
    const txData = JSON.parse(payload)
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
      io.print('❌ Wrong password. Please try again.')
      throw new CliExit(1)
    }
    if (e instanceof WalletError || e instanceof SyntaxError) {
      io.print(`Error: ${(e as Error).message}`)
      throw new CliExit(1)
    }
    throw e
  }
}

export async function cmdSignMsg(wallet: string | undefined, message: string, dir: string, io: CliIO, opts?: { password?: string }): Promise<void> {
  const walletId = resolveWalletId(wallet, dir, io)
  const pw = await getPassword(io, { explicit: opts?.password })

  try {
    const provider = WalletFactory({ secretsDir: dir, password: pw })
    const w = await provider.getWallet(walletId)
    const signature = await w.signMessage(Buffer.from(message, 'utf-8'))
    io.print(`Signature: ${signature}`)
  } catch (e) {
    if (e instanceof DecryptionError) {
      io.print('❌ Wrong password. Please try again.')
      throw new CliExit(1)
    }
    if (e instanceof WalletError) {
      io.print(`Error: ${e.message}`)
      throw new CliExit(1)
    }
    throw e
  }
}

export async function cmdSignTypedData(wallet: string | undefined, data: string, dir: string, io: CliIO, opts?: { password?: string }): Promise<void> {
  const walletId = resolveWalletId(wallet, dir, io)
  const pw = await getPassword(io, { explicit: opts?.password })

  try {
    const provider = WalletFactory({ secretsDir: dir, password: pw })
    const w = await provider.getWallet(walletId)
    if (!('signTypedData' in w)) {
      io.print('This wallet does not support EIP-712 signing.')
      throw new CliExit(1)
    }
    const typedData = JSON.parse(data)
    const signature = await (w as unknown as Eip712Capable).signTypedData(typedData)
    io.print(`Signature: ${signature}`)
  } catch (e) {
    if (e instanceof DecryptionError) {
      io.print('❌ Wrong password. Please try again.')
      throw new CliExit(1)
    }
    if (e instanceof WalletError || e instanceof SyntaxError) {
      io.print(`Error: ${(e as Error).message}`)
      throw new CliExit(1)
    }
    throw e
  }
}

export async function cmdChangePassword(dir: string, io: CliIO, opts?: { password?: string }): Promise<void> {
  const oldPw = opts?.password ?? process.env.AGENT_WALLET_PASSWORD ?? (await io.prompt('Current password', { password: true }))

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
    if (file.startsWith('id_') && file.endsWith('.json')) {
      const name = file.slice(3, -5)
      const key = kvStoreOld.loadPrivateKey(name)
      kvStoreNew.savePrivateKey(name, key)
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
}

// --- Helpers (output) ---

function printWalletTable(io: CliIO, rows: [string, string, string][]): void {
  const c1 = 20, c2 = 15, c3 = 44
  const hr = (l: string, m: string, r: string) => `${l}${'─'.repeat(c1 + 2)}${m}${'─'.repeat(c2 + 2)}${m}${'─'.repeat(c3 + 2)}${r}`
  io.print(hr('┌', '┬', '┐'))
  io.print(`│ ${'Wallet ID'.padEnd(c1)} │ ${'Type'.padEnd(c2)} │ ${'Address'.padEnd(c3)} │`)
  io.print(hr('├', '┼', '┤'))
  for (const [id, type, address] of rows) {
    io.print(`│ ${id.padEnd(c1)} │ ${type.padEnd(c2)} │ ${address.padEnd(c3)} │`)
  }
  io.print(hr('└', '┴', '┘'))
}

// --- Start Command ---

const START_TYPE_MAP: Record<string, WalletType> = {
  tron: WalletType.TRON_LOCAL,
  evm: WalletType.EVM_LOCAL,
  tron_local: WalletType.TRON_LOCAL,
  evm_local: WalletType.EVM_LOCAL,
}

export async function cmdStart(dir: string, io: CliIO, opts?: { password?: string; importType?: string }): Promise<void> {
  const masterPath = join(dir, 'master.json')
  let config: WalletsTopology
  let kvStore: SecureKVStore
  let pw: string
  let autoGenerated = false

  if (existsSync(masterPath)) {
    // Already initialized — need existing password
    pw = await getPassword(io, { explicit: opts?.password })
    kvStore = new SecureKVStore(dir, pw)
    try {
      kvStore.verifyPassword()
    } catch (e) {
      if (e instanceof DecryptionError) {
        io.print('❌ Wrong password. Please try again.')
        throw new CliExit(1)
      }
      throw e
    }
    config = loadConfigSafe(dir)
    io.print('\n🔐 Wallet already initialized.')
  } else {
    // Fresh init
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
      /* ignore on platforms without chmod support */
    }
    kvStore = new SecureKVStore(dir, pw)
    kvStore.initMaster()
    config = { config_version: 1, wallets: {}, active_wallet: null }
    saveConfig(dir, config)
    io.print('\n🔐 Wallet initialized!')
  }

  if (opts?.importType) {
    // Import mode: single wallet
    const walletType = START_TYPE_MAP[opts.importType]
    if (!walletType) {
      io.print(`Unknown wallet type: ${opts.importType}. Use: tron, evm, tron_local, evm_local`)
      throw new CliExit(1)
    }
    const name = walletType === WalletType.TRON_LOCAL ? 'default_tron' : 'default_evm'

    if (config.wallets[name]) {
      // Already exists — just show info
      const conf = config.wallets[name]
      io.print('\n🪙 Wallet already exists:')
      printWalletTable(io, [[name, conf.type, conf.address ?? '']])
    } else {
      const keyHex = await io.prompt('Paste private key (hex)', { password: true })
      const cleaned = keyHex.trim().replace(/^0x/, '')
      let privateKey: Buffer
      try {
        privateKey = Buffer.from(cleaned, 'hex')
      } catch {
        io.print('Invalid hex string.')
        throw new CliExit(1)
      }
      if (privateKey.length !== 32) {
        io.print('Invalid private key length. Expected 32 bytes.')
        throw new CliExit(1)
      }
      kvStore.savePrivateKey(name, privateKey)

      const address = deriveAddress(walletType, privateKey)
      config.wallets[name] = { type: walletType, identity_file: name, address } as unknown as WalletConfig
      if (!config.active_wallet) config.active_wallet = name
      saveConfig(dir, config)

      io.print('\n🪙 Imported wallet:')
      printWalletTable(io, [[name, walletType, address]])
    }
  } else {
    // Default mode: create missing wallets
    const rows: [string, string, string][] = []
    let changed = false

    if (config.wallets['default_tron']) {
      const c = config.wallets['default_tron']
      rows.push(['default_tron', c.type, c.address ?? ''])
    } else {
      const key = kvStore.generateKey('default_tron')
      const addr = deriveAddress(WalletType.TRON_LOCAL, key)
      config.wallets['default_tron'] = { type: WalletType.TRON_LOCAL, identity_file: 'default_tron', address: addr } as unknown as WalletConfig
      rows.push(['default_tron', WalletType.TRON_LOCAL, addr])
      changed = true
    }

    if (config.wallets['default_evm']) {
      const c = config.wallets['default_evm']
      rows.push(['default_evm', c.type, c.address ?? ''])
    } else {
      const key = kvStore.generateKey('default_evm')
      const addr = deriveAddress(WalletType.EVM_LOCAL, key)
      config.wallets['default_evm'] = { type: WalletType.EVM_LOCAL, identity_file: 'default_evm', address: addr } as unknown as WalletConfig
      rows.push(['default_evm', WalletType.EVM_LOCAL, addr])
      changed = true
    }

    if (!config.active_wallet) config.active_wallet = 'default_tron'
    if (changed) saveConfig(dir, config)

    io.print('\n🪙 Wallets:')
    printWalletTable(io, rows)
  }

  io.print(`\n⭐ Active wallet: ${config.active_wallet}`)

  if (autoGenerated) {
    io.print(`\n🔑 Your master password: ${pw}`)
    io.print('   ⚠️  Save this password! You\'ll need it for signing and other operations.')
  }

  io.print('\n💡 Quick guide:')
  io.print('   agent-wallet list              — View your wallets')
  io.print("   agent-wallet sign tx '{...}'   — Sign a transaction")
  io.print('   agent-wallet start -h          — See all options')
  io.print('')
}

// --- Reset Command ---

export async function cmdReset(dir: string, yes: boolean, io: CliIO): Promise<void> {
  if (!existsSync(join(dir, 'master.json'))) {
    io.print('⚠️  No wallet data found in: ' + dir)
    throw new CliExit(1)
  }

  const files = readdirSync(dir).filter(f => f.endsWith('.json'))
  io.print(`⚠️  This will delete ALL wallet data in: ${dir}`)
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
    io.print(`  🗑️  Deleted: ${f}`)
  }
  io.print('')
  io.print('✅ Wallet data reset complete.')
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
    } else if (arg.startsWith('-') && arg.length === 2) {
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
  const WALLET_OPT = '  --wallet, -w <id>     Wallet ID (uses active wallet if omitted)'

  const showCommandHelp = (command: string, subcommand: string | undefined, io: CliIO): 0 => {
    switch (command) {
      case 'start':
        io.print('Usage: agent-wallet start [options]')
        io.print('')
        io.print('Quick setup: initialize and create default wallets.')
        io.print('')
        io.print('Options:')
        io.print('  --password, -p <pw>   Master password (auto-generated if omitted)')
        io.print('  --import, -i <type>   Import wallet type: tron, evm, tron_local, evm_local')
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
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        break
      case 'add':
        io.print('Usage: agent-wallet add [options]')
        io.print('')
        io.print('Add a new wallet (interactive).')
        io.print('')
        io.print('Options:')
        io.print(PW_OPT)
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
        io.print('Show wallet details including address.')
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
          io.print('')
          io.print('Options:')
          io.print(WALLET_OPT)
          io.print(PW_OPT)
          io.print(DIR_OPT)
          io.print(HELP_OPT)
        } else if (subcommand === 'msg') {
          io.print('Usage: agent-wallet sign msg <message> [options]')
          io.print('')
          io.print('Sign a message.')
          io.print('')
          io.print('Options:')
          io.print(WALLET_OPT)
          io.print(PW_OPT)
          io.print(DIR_OPT)
          io.print(HELP_OPT)
        } else if (subcommand === 'typed-data') {
          io.print('Usage: agent-wallet sign typed-data <data> [options]')
          io.print('')
          io.print('Sign EIP-712 typed data. Data is a JSON string.')
          io.print('')
          io.print('Options:')
          io.print(WALLET_OPT)
          io.print(PW_OPT)
          io.print(DIR_OPT)
          io.print(HELP_OPT)
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
        }
        break
      case 'change-password':
        io.print('Usage: agent-wallet change-password [options]')
        io.print('')
        io.print('Change master password and re-encrypt all files.')
        io.print('')
        io.print('Options:')
        io.print('  --password, -p <pw>   Current master password (skip prompt)')
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        break
      case 'reset':
        io.print('Usage: agent-wallet reset [options]')
        io.print('')
        io.print('Delete all wallet data (master key, wallets, credentials).')
        io.print('')
        io.print('Options:')
        io.print('  --yes, -y             Skip confirmation')
        io.print(DIR_OPT)
        io.print(HELP_OPT)
        break
      default:
        // Global help
        io.print('Usage: agent-wallet <command> [options]')
        io.print('')
        io.print('Commands:')
        io.print('  start             Quick setup: init + create default wallets')
        io.print('  init              Initialize secrets directory and set master password')
        io.print('  add               Add a new wallet (interactive)')
        io.print('  list              List all configured wallets')
        io.print('  use <id>          Set the active wallet')
        io.print('  inspect <id>      Show wallet details')
        io.print('  remove <id>       Remove a wallet')
        io.print('  sign tx <data>    Sign a transaction (JSON payload as argument)')
        io.print('  sign msg <data>   Sign a message (message as argument)')
        io.print('  sign typed-data <data>  Sign EIP-712 typed data (JSON as argument)')
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

  try {
    switch (command) {
      case 'start': {
        const importType = (options.import ?? options.i) as string | undefined
        await cmdStart(dir, cliIO, { password, importType })
        break
      }
      case 'init':
        await cmdInit(dir, cliIO, { password })
        break
      case 'add':
        await cmdAdd(dir, cliIO, { password })
        break
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
        await cmdRemove(subcommand ?? args[0], dir, options.yes === true || options.y === true, cliIO)
        break
      case 'sign':
        if (!subcommand) {
          cliIO.print('Usage: agent-wallet sign <tx|msg|typed-data> <data> [options]')
          return 1
        }
        switch (subcommand) {
          case 'tx':
            await cmdSignTx((options.wallet ?? options.w) as string, args[0], dir, cliIO, { password })
            break
          case 'msg':
            await cmdSignMsg((options.wallet ?? options.w) as string, args[0], dir, cliIO, { password })
            break
          case 'typed-data':
            await cmdSignTypedData((options.wallet ?? options.w) as string, args[0], dir, cliIO, { password })
            break
          default:
            cliIO.print(`Unknown sign subcommand: ${subcommand}`)
            return 1
        }
        break
      case 'change-password':
        await cmdChangePassword(dir, cliIO, { password })
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
    throw e
  }

  return 0
}

// Run when executed directly
const isMainModule = typeof import.meta.url !== 'undefined' && import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  main().then((code) => process.exit(code))
}
