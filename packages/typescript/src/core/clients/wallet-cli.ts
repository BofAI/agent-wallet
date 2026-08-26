import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, resolve } from 'node:path'
import { z } from 'zod'

import { WalletCliExecutionError, WalletCliNotFoundError, WalletCliUsageError } from '../errors.js'
import type { SecretLease } from '../secret-provider.js'
import type { WalletCliNetworkTarget } from '../wallet-cli-network.js'

export const WALLET_CLI_MIN_VERSION = '4.13.0'
export const WALLET_CLI_MAX_MAJOR = 5
export const DEFAULT_WALLET_CLI_TIMEOUT_MS = 60_000
export const DEFAULT_WALLET_CLI_KILL_GRACE_MS = 5_000
export const DEFAULT_WALLET_CLI_STDOUT_LIMIT = 2 * 1024 * 1024
export const DEFAULT_WALLET_CLI_STDERR_LIMIT = 64 * 1024

const ENV_WALLET_CLI_PATH = 'AGENT_WALLET_WALLET_CLI_PATH'
const MIN_NODE_MAJOR = 20

export interface WalletCliLaunchTarget {
  command: string
  argsPrefix?: readonly string[]
}

export interface WalletCliClientOptions {
  launchTarget?: WalletCliLaunchTarget
  /** Backward-compatible executable/path override. */
  binary?: string
  timeoutMs?: number
  killGraceMs?: number
  maxStdoutBytes?: number
  maxStderrBytes?: number
  env?: NodeJS.ProcessEnv
}

export type WalletCliWarning = string | { code: string; message: string }

export interface WalletCliChainContext {
  family: string
  network: string
  chainId: string
}

export interface WalletCliMeta {
  durationMs: number
  warnings: WalletCliWarning[]
  [key: string]: unknown
}

export interface WalletCliSuccessResult<T> {
  schema: 'wallet-cli.result.v1'
  success: true
  command: string
  data: T
  chain?: WalletCliChainContext
  meta: WalletCliMeta
  [key: string]: unknown
}

export interface WalletCliFailureResult {
  schema: 'wallet-cli.result.v1'
  success: false
  command: string
  error: { code: string; message: string; details?: unknown }
  chain?: WalletCliChainContext
  meta: WalletCliMeta
  [key: string]: unknown
}

export type WalletCliResult<T> = WalletCliSuccessResult<T> | WalletCliFailureResult

export interface WalletCliNetworkRow {
  id: string
  alias?: string
  family: string
  chainId: string
  [key: string]: unknown
}

export interface WalletCliCatalogCommand {
  id: string
  kind: 'neutral' | 'chain'
  families?: string[]
  path: string[]
  [key: string]: unknown
}

export interface WalletCliCatalog {
  tool: 'wallet-cli'
  version: string
  globalFlags: unknown[]
  commands: WalletCliCatalogCommand[]
  [key: string]: unknown
}

export interface WalletCliCompatibility {
  version: string
  catalog: WalletCliCatalog
  networks: WalletCliNetworkRow[]
  network?: WalletCliNetworkRow
}

export interface WalletCliCurrentAccountData {
  accountId: string
  label?: string
  type: string
  index: number | null
  active: boolean
  addresses: { tron?: string; evm?: string }
  seedId?: string
  [key: string]: unknown
}

export interface WalletCliTronTxSignData {
  kind: string
  mode: string
  address: string
  txId?: string
  signed: Record<string, unknown> & { signature: string[] }
  [key: string]: unknown
}

export interface WalletCliEvmTxSignData {
  kind: string
  mode: string
  address: string
  txId?: string
  signed: { raw: string; hash: string; [key: string]: unknown }
  [key: string]: unknown
}

/** Backward-compatible alias for the TRON result shape. */
export type WalletCliTxSignData = WalletCliTronTxSignData

export interface WalletCliMessageSignData {
  address: string
  message: string
  signature: string
  [key: string]: unknown
}

export interface WalletCliTypedDataSignData {
  address: string
  primaryType: string
  digest: string
  signature: string
  [key: string]: unknown
}

const WarningSchema = z.union([
  z.string(),
  z.object({ code: z.string(), message: z.string() }).passthrough(),
])
const MetaSchema = z
  .object({ durationMs: z.number(), warnings: z.array(WarningSchema) })
  .passthrough()
const ChainSchema = z
  .object({ family: z.string(), network: z.string(), chainId: z.string() })
  .passthrough()
const SuccessEnvelopeSchema = z
  .object({
    schema: z.literal('wallet-cli.result.v1'),
    success: z.literal(true),
    command: z.string(),
    data: z.unknown(),
    meta: MetaSchema,
    chain: ChainSchema.optional(),
  })
  .passthrough()
const FailureEnvelopeSchema = z
  .object({
    schema: z.literal('wallet-cli.result.v1'),
    success: z.literal(false),
    command: z.string(),
    error: z
      .object({ code: z.string(), message: z.string(), details: z.unknown().optional() })
      .passthrough(),
    meta: MetaSchema,
    chain: ChainSchema.optional(),
  })
  .passthrough()
const ResultEnvelopeSchema = z.discriminatedUnion('success', [
  SuccessEnvelopeSchema,
  FailureEnvelopeSchema,
])

const NetworkRowSchema = z
  .object({
    id: z.string().min(1),
    alias: z.string().optional(),
    family: z.string().min(1),
    chainId: z.string().min(1),
  })
  .passthrough()
const NetworksDataSchema = z.array(NetworkRowSchema)
const CatalogCommandSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['neutral', 'chain']),
    families: z.array(z.string()).optional(),
    path: z.array(z.string()),
  })
  .passthrough()
const CatalogSchema = z
  .object({
    tool: z.literal('wallet-cli'),
    version: z.string(),
    globalFlags: z.array(z.unknown()),
    commands: z.array(CatalogCommandSchema),
  })
  .passthrough()
const CurrentAccountSchema = z
  .object({
    accountId: z.string().min(1),
    label: z.string().optional(),
    type: z.string().min(1),
    index: z.number().int().nonnegative().nullable(),
    active: z.boolean(),
    addresses: z
      .object({ tron: z.string().min(1).optional(), evm: z.string().min(1).optional() })
      .passthrough()
      .refine((addresses) => Boolean(addresses.tron || addresses.evm), 'address is required'),
    seedId: z.string().optional(),
  })
  .passthrough()
const TronTxSignDataSchema = z
  .object({
    kind: z.literal('sign'),
    mode: z.literal('sign-only'),
    address: z.string().min(1),
    txId: z.string().optional(),
    signed: z.object({ signature: z.array(z.string().min(1)).min(1) }).passthrough(),
  })
  .passthrough()
const HexSchema = z.string().regex(/^0x[0-9a-fA-F]+$/)
const EvmTxSignDataSchema = z
  .object({
    kind: z.literal('sign'),
    mode: z.literal('sign-only'),
    address: z.string().min(1),
    txId: z.string().optional(),
    signed: z.object({ raw: HexSchema, hash: HexSchema }).passthrough(),
  })
  .passthrough()
const MessageSignDataSchema = z
  .object({ address: z.string().min(1), message: z.string(), signature: HexSchema })
  .passthrough()
const TypedDataSignDataSchema = z
  .object({
    address: z.string().min(1),
    primaryType: z.string().min(1),
    digest: HexSchema,
    signature: HexSchema,
  })
  .passthrough()

export interface WalletCliRunContract<T> {
  command: string
  dataSchema: z.ZodType<T>
  chain: 'none' | WalletCliNetworkRow | WalletCliNetworkRow[]
  stdin?: string | Buffer | SecretLease
  signal?: AbortSignal
}

interface ProcessResult {
  stdout: Buffer
  exitCode: number | null
}

export class WalletCliClient {
  private readonly options: WalletCliClientOptions
  private launchTarget?: WalletCliLaunchTarget
  private compatibilityPromise?: Promise<WalletCliCompatibility>

  constructor(options: WalletCliClientOptions = {}) {
    this.options = { ...options }
  }

  async ensureCompatible(target?: WalletCliNetworkTarget): Promise<WalletCliCompatibility> {
    if (!this.compatibilityPromise) {
      this.compatibilityPromise = this.loadCompatibility()
    }
    const compatibility = await this.compatibilityPromise
    if (!target) return compatibility

    for (const id of ['tx.sign', 'message.sign', 'typed-data.sign']) {
      const command = compatibility.catalog.commands.find((entry) => entry.id === id)
      if (!command || command.kind !== 'chain' || !command.families?.includes(target.family)) {
        throw new WalletCliExecutionError(
          `wallet-cli capability '${id}' is unavailable for ${target.family}`,
          'capability_missing',
        )
      }
    }

    const network = compatibility.networks.find((row) => row.id === target.cliNetwork)
    if (!network || network.family !== target.family) {
      throw new WalletCliExecutionError(
        `wallet-cli network '${target.cliNetwork}' is unavailable`,
        'network_mismatch',
      )
    }
    if (target.requestedChainId && network.chainId !== target.requestedChainId) {
      throw new WalletCliExecutionError(
        `wallet-cli network '${target.cliNetwork}' reports an unexpected chainId`,
        'network_mismatch',
      )
    }
    return { ...compatibility, network }
  }

  async currentAccount(
    accountRef?: string,
    target?: WalletCliNetworkTarget,
  ): Promise<WalletCliSuccessResult<WalletCliCurrentAccountData>> {
    const compatibility = await this.ensureCompatible(target)
    const args = ['current']
    if (accountRef) args.push('--account', accountRef)
    if (target) args.push('--network', target.cliNetwork)
    args.push('-o', 'json')
    return this.run(args, {
      command: 'current',
      dataSchema: CurrentAccountSchema,
      chain: target ? compatibility.network! : compatibility.networks,
    })
  }

  async signTronTransaction(
    transactionJson: string,
    lease: SecretLease,
    identity: { accountId: string },
    target: WalletCliNetworkTarget,
    signal?: AbortSignal,
  ): Promise<WalletCliSuccessResult<WalletCliTronTxSignData>> {
    const compatibility = await this.ensureCompatible(target)
    return this.run(
      [
        'tx',
        'sign',
        '--transaction',
        transactionJson,
        '--account',
        identity.accountId,
        '--network',
        target.cliNetwork,
        '--password-stdin',
        '-o',
        'json',
      ],
      {
        command: 'tx.sign',
        dataSchema: TronTxSignDataSchema,
        chain: compatibility.network!,
        stdin: lease,
        signal,
      },
    )
  }

  async signEvmTransaction(
    unsignedHex: string,
    lease: SecretLease,
    identity: { accountId: string },
    target: WalletCliNetworkTarget,
    signal?: AbortSignal,
  ): Promise<WalletCliSuccessResult<WalletCliEvmTxSignData>> {
    const compatibility = await this.ensureCompatible(target)
    return this.run(
      [
        'tx',
        'sign',
        '--hex',
        unsignedHex,
        '--account',
        identity.accountId,
        '--network',
        target.cliNetwork,
        '--password-stdin',
        '-o',
        'json',
      ],
      {
        command: 'tx.sign',
        dataSchema: EvmTxSignDataSchema,
        chain: compatibility.network!,
        stdin: lease,
        signal,
      },
    )
  }

  async signMessage(
    message: string,
    lease: SecretLease,
    identity: { accountId: string },
    target: WalletCliNetworkTarget,
    signal?: AbortSignal,
  ): Promise<WalletCliSuccessResult<WalletCliMessageSignData>> {
    const compatibility = await this.ensureCompatible(target)
    return this.run(
      [
        'message',
        'sign',
        '--message',
        message,
        '--account',
        identity.accountId,
        '--network',
        target.cliNetwork,
        '--password-stdin',
        '-o',
        'json',
      ],
      {
        command: 'message.sign',
        dataSchema: MessageSignDataSchema,
        chain: compatibility.network!,
        stdin: lease,
        signal,
      },
    )
  }

  async signTypedData(
    typedDataJson: string,
    lease: SecretLease,
    identity: { accountId: string },
    target: WalletCliNetworkTarget,
    signal?: AbortSignal,
  ): Promise<WalletCliSuccessResult<WalletCliTypedDataSignData>> {
    const compatibility = await this.ensureCompatible(target)
    return this.run(
      [
        'typed-data',
        'sign',
        '--typed-data',
        typedDataJson,
        '--account',
        identity.accountId,
        '--network',
        target.cliNetwork,
        '--password-stdin',
        '-o',
        'json',
      ],
      {
        command: 'typed-data.sign',
        dataSchema: TypedDataSignDataSchema,
        chain: compatibility.network!,
        stdin: lease,
        signal,
      },
    )
  }

  async run<T>(
    args: string[],
    contract: WalletCliRunContract<T>,
  ): Promise<WalletCliSuccessResult<T>> {
    const processResult = await this.runProcess(args, contract.stdin, contract.signal)
    return parseOperationalResult(processResult, contract)
  }

  private async loadCompatibility(): Promise<WalletCliCompatibility> {
    const [versionOutput, catalogOutput] = await Promise.all([
      this.runMeta(['--version']),
      this.runMeta(['--json-schema']),
    ])
    const version = parseSupportedVersion(versionOutput.toString('utf8'))

    let catalogJson: unknown
    try {
      catalogJson = JSON.parse(catalogOutput.toString('utf8'))
    } catch {
      throw new WalletCliExecutionError(
        'wallet-cli capability catalog is not valid JSON',
        'contract_mismatch',
      )
    }
    const catalogResult = CatalogSchema.safeParse(catalogJson)
    if (!catalogResult.success || catalogResult.data.version !== version) {
      throw new WalletCliExecutionError(
        'wallet-cli capability catalog does not match the executable version',
        'contract_mismatch',
      )
    }
    if (
      !catalogResult.data.commands.some(
        (entry) => entry.id === 'current' && entry.kind === 'neutral',
      )
    ) {
      throw new WalletCliExecutionError(
        "wallet-cli capability 'current' is unavailable",
        'capability_missing',
      )
    }

    const networksResult = await this.run(['networks', '-o', 'json'], {
      command: 'networks',
      dataSchema: NetworksDataSchema,
      chain: 'none',
    })
    return {
      version,
      catalog: catalogResult.data as WalletCliCatalog,
      networks: networksResult.data,
    }
  }

  private async runMeta(args: string[]): Promise<Buffer> {
    const result = await this.runProcess(args)
    if (result.exitCode !== 0) {
      throw new WalletCliExecutionError(
        `wallet-cli metadata command exited with code ${result.exitCode}`,
        'contract_mismatch',
      )
    }
    return result.stdout
  }

  private runProcess(
    args: string[],
    stdin?: string | Buffer | SecretLease,
    signal?: AbortSignal,
  ): Promise<ProcessResult> {
    const target = this.resolveLaunchTarget()
    this.checkNodeVersion(target)
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_WALLET_CLI_TIMEOUT_MS
    const killGraceMs = this.options.killGraceMs ?? DEFAULT_WALLET_CLI_KILL_GRACE_MS
    const maxStdoutBytes = this.options.maxStdoutBytes ?? DEFAULT_WALLET_CLI_STDOUT_LIMIT
    const maxStderrBytes = this.options.maxStderrBytes ?? DEFAULT_WALLET_CLI_STDERR_LIMIT

    if (signal?.aborted) {
      return Promise.reject(
        new WalletCliExecutionError('wallet-cli operation was aborted', 'aborted'),
      )
    }

    return new Promise<ProcessResult>((resolvePromise, rejectPromise) => {
      const child = spawn(target.command, [...(target.argsPrefix ?? []), ...args], {
        env: this.options.env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      })
      const stdout: Buffer[] = []
      let stdoutBytes = 0
      let stderrBytes = 0
      let timedOut = false
      let aborted = false
      let stdinFailed = false
      let exceeded: 'stdout' | 'stderr' | undefined
      let settled = false
      let terminating = false
      let killTimer: NodeJS.Timeout | undefined

      const cleanup = () => {
        clearTimeout(timeoutTimer)
        clearTimeout(killTimer)
        signal?.removeEventListener('abort', onAbort)
      }
      const reject = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        rejectPromise(error)
      }
      const resolveResult = (result: ProcessResult) => {
        if (settled) return
        settled = true
        cleanup()
        resolvePromise(result)
      }
      const terminate = () => {
        if (terminating) return
        terminating = true
        child.kill('SIGTERM')
        killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs)
        killTimer.unref?.()
      }
      const timeoutTimer = setTimeout(() => {
        if (terminating) return
        timedOut = true
        terminate()
      }, timeoutMs)
      const onAbort = () => {
        if (terminating) return
        aborted = true
        clearTimeout(timeoutTimer)
        terminate()
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      child.stdout.on('data', (chunk: Buffer) => {
        if (exceeded) return
        stdoutBytes += chunk.length
        if (stdoutBytes > maxStdoutBytes) {
          exceeded = 'stdout'
          clearTimeout(timeoutTimer)
          terminate()
          return
        }
        stdout.push(Buffer.from(chunk))
      })
      child.stderr.on('data', (chunk: Buffer) => {
        if (exceeded) return
        stderrBytes += chunk.length
        if (stderrBytes > maxStderrBytes) {
          exceeded = 'stderr'
          clearTimeout(timeoutTimer)
          terminate()
        }
      })
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          reject(
            new WalletCliNotFoundError(
              'wallet-cli launch target was not found; install @tron-walletcli/wallet-cli, set AGENT_WALLET_WALLET_CLI_PATH, or inject launchTarget',
            ),
          )
          return
        }
        reject(new WalletCliExecutionError('wallet-cli process failed to start', 'spawn_error'))
      })
      child.on('close', (exitCode) => {
        if (aborted) {
          reject(new WalletCliExecutionError('wallet-cli operation was aborted', 'aborted'))
          return
        }
        if (timedOut) {
          reject(new WalletCliExecutionError('wallet-cli process timed out', 'timeout'))
          return
        }
        if (exceeded) {
          reject(
            new WalletCliExecutionError(
              `wallet-cli exceeded the configured ${exceeded} limit`,
              'output_limit',
            ),
          )
          return
        }
        if (stdinFailed) {
          reject(new WalletCliExecutionError('wallet-cli stdin write failed', 'stdin_write'))
          return
        }
        resolveResult({ stdout: Buffer.concat(stdout, stdoutBytes), exitCode })
      })

      const writeInput = async () => {
        if (!child.stdin) return
        if (isSecretLease(stdin)) {
          await stdin.writeTo(child.stdin)
          return
        }
        if (stdin === undefined) child.stdin.end()
        else child.stdin.end(stdin)
      }
      void writeInput().catch(() => {
        if (terminating) return
        stdinFailed = true
        terminate()
      })
    })
  }

  private resolveLaunchTarget(): WalletCliLaunchTarget {
    if (this.launchTarget) return this.launchTarget
    if (this.options.launchTarget) {
      this.launchTarget = validateWalletCliLaunchTarget(this.options.launchTarget)
      return this.launchTarget
    }
    if (this.options.binary?.trim()) {
      this.launchTarget = walletCliLaunchTargetFromPath(this.options.binary.trim())
      return this.launchTarget
    }
    const envPath = this.options.env?.[ENV_WALLET_CLI_PATH] ?? process.env[ENV_WALLET_CLI_PATH]
    if (envPath?.trim()) {
      this.launchTarget = walletCliLaunchTargetFromPath(envPath.trim())
      return this.launchTarget
    }
    const packageEntrypoint = resolveOptionalPeerEntrypoint()
    if (packageEntrypoint) {
      this.launchTarget = walletCliLaunchTargetFromPath(packageEntrypoint)
      return this.launchTarget
    }
    this.launchTarget = { command: 'wallet-cli' }
    return this.launchTarget
  }

  private checkNodeVersion(target: WalletCliLaunchTarget): void {
    assertWalletCliNodeRuntime(target)
  }
}

export function assertWalletCliNodeRuntime(
  target: WalletCliLaunchTarget,
  nodeVersion = process.version,
  nodePath = process.execPath,
): void {
  if (target.command !== nodePath) return
  const major = Number.parseInt(nodeVersion.slice(1).split('.')[0], 10)
  if (major < MIN_NODE_MAJOR) {
    throw new WalletCliExecutionError(
      `wallet-cli JavaScript entrypoint requires Node.js >=${MIN_NODE_MAJOR}; current runtime is ${nodeVersion}`,
      'unsupported_runtime',
    )
  }
}

function parseOperationalResult<T>(
  processResult: ProcessResult,
  contract: WalletCliRunContract<T>,
): WalletCliSuccessResult<T> {
  let json: unknown
  try {
    json = JSON.parse(processResult.stdout.toString('utf8'))
  } catch {
    return throwInvalidEnvelope(processResult.exitCode)
  }
  const parsed = ResultEnvelopeSchema.safeParse(json)
  if (!parsed.success) return throwInvalidEnvelope(processResult.exitCode)
  const envelope = parsed.data

  if (envelope.command !== contract.command) {
    throw new WalletCliExecutionError(
      `wallet-cli returned command '${envelope.command}' while '${contract.command}' was expected`,
      'contract_mismatch',
    )
  }

  if (!envelope.success) {
    if (envelope.chain) validateChain(envelope.chain, contract.chain)
    const code = envelope.error.code || 'internal_error'
    const message = sanitizeMessage(envelope.error.message)
    if (processResult.exitCode === 2) throw new WalletCliUsageError(message, code)
    if (processResult.exitCode !== 1) {
      throw new WalletCliExecutionError(
        'wallet-cli exit status and failure envelope disagree',
        'contract_mismatch',
      )
    }
    throw new WalletCliExecutionError(message, code)
  }

  if (processResult.exitCode !== 0) {
    throw new WalletCliExecutionError(
      'wallet-cli exit status and success envelope disagree',
      'contract_mismatch',
    )
  }
  validateChain(envelope.chain, contract.chain)
  const data = contract.dataSchema.safeParse(envelope.data)
  if (!data.success) {
    throw new WalletCliExecutionError(
      `wallet-cli returned invalid data for '${contract.command}'`,
      'contract_mismatch',
    )
  }
  return { ...envelope, data: data.data } as WalletCliSuccessResult<T>
}

function throwInvalidEnvelope(exitCode: number | null): never {
  if (exitCode === 2) {
    throw new WalletCliUsageError(
      'wallet-cli returned an invalid usage envelope',
      'contract_mismatch',
    )
  }
  throw new WalletCliExecutionError(
    'wallet-cli returned an invalid result envelope',
    'contract_mismatch',
  )
}

function validateChain(
  actual: WalletCliChainContext | undefined,
  expected: 'none' | WalletCliNetworkRow | WalletCliNetworkRow[],
): void {
  if (expected === 'none') {
    if (actual) {
      throw new WalletCliExecutionError(
        'wallet-cli returned unexpected chain context for a neutral command',
        'contract_mismatch',
      )
    }
    return
  }
  if (Array.isArray(expected)) {
    if (
      !actual ||
      !expected.some(
        (network) =>
          actual.family === network.family &&
          actual.network === network.id &&
          actual.chainId === network.chainId,
      )
    ) {
      throw new WalletCliExecutionError(
        'wallet-cli returned an unadvertised chain context',
        'network_mismatch',
      )
    }
    return
  }
  if (
    !actual ||
    actual.family !== expected.family ||
    actual.network !== expected.id ||
    actual.chainId !== expected.chainId
  ) {
    throw new WalletCliExecutionError(
      'wallet-cli returned mismatched chain context',
      'network_mismatch',
    )
  }
}

function sanitizeMessage(message: string): string {
  const sanitized = Array.from(message, (character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f ? ' ' : character
  }).join('')
  return sanitized.slice(0, 512) || 'wallet-cli failed'
}

function parseSupportedVersion(output: string): string {
  const version = output.trim()
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) {
    throw new WalletCliExecutionError(
      'wallet-cli returned an unsupported version string',
      'unsupported_version',
    )
  }
  const [, majorRaw, minorRaw] = match
  const major = Number(majorRaw)
  const minor = Number(minorRaw)
  if (major !== 4 || minor < 13) {
    throw new WalletCliExecutionError(
      `wallet-cli ${version} is unsupported; expected >=${WALLET_CLI_MIN_VERSION} <${WALLET_CLI_MAX_MAJOR}.0.0`,
      'unsupported_version',
    )
  }
  return version
}

export function validateWalletCliLaunchTarget(
  target: WalletCliLaunchTarget,
  platform: NodeJS.Platform = process.platform,
): WalletCliLaunchTarget {
  if (!target.command.trim()) {
    throw new WalletCliNotFoundError('wallet-cli launch target command is empty')
  }
  if (platform === 'win32' && ['.cmd', '.bat'].includes(extname(target.command).toLowerCase())) {
    throw new WalletCliNotFoundError(
      'Windows .cmd/.bat wallet-cli shims are not launched through a shell; provide the package JavaScript entrypoint instead',
    )
  }
  return {
    command: target.command,
    argsPrefix: target.argsPrefix ? [...target.argsPrefix] : undefined,
  }
}

export function walletCliLaunchTargetFromPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
  nodePath = process.execPath,
): WalletCliLaunchTarget {
  const extension = extname(path).toLowerCase()
  if (['.js', '.mjs', '.cjs'].includes(extension)) {
    return { command: nodePath, argsPrefix: [path] }
  }
  return validateWalletCliLaunchTarget({ command: path }, platform)
}

function resolveOptionalPeerEntrypoint(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const packagePath = require.resolve('@tron-walletcli/wallet-cli/package.json')
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      bin?: string | Record<string, string>
    }
    const bin =
      typeof packageJson.bin === 'string'
        ? packageJson.bin
        : (packageJson.bin?.['wallet-cli'] ?? Object.values(packageJson.bin ?? {})[0])
    return bin ? resolve(dirname(packagePath), bin) : undefined
  } catch {
    return undefined
  }
}

function isSecretLease(value: unknown): value is SecretLease {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SecretLease).writeTo === 'function' &&
    typeof (value as SecretLease).dispose === 'function'
  )
}
