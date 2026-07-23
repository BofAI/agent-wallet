/**
 * WalletCliClient — subprocess transport for the wallet-cli CLI.
 *
 * Spawns `wallet-cli <command> -o json`, parses the `wallet-cli.result.v1`
 * JSON envelope, and dispatches errors by exit code (0 success / 1 execution /
 * 2 usage). Secrets (keystore password, signed tx) go through stdin, never
 * argv — per wallet-cli's single-stdin-consumer contract.
 *
 * Trade-off: signing payloads (transaction JSON, message text, typed-data
 * JSON) are passed via argv, not stdin. This is intentional — wallet-cli
 * supports only one stdin consumer per invocation, and the keystore password
 * (the more sensitive secret) takes that slot via --password-stdin. Unsigned
 * transaction payloads are therefore visible in `ps`/process listings. If
 * wallet-cli later adds --transaction-stdin support, the password could be
 * passed via env or a file descriptor instead, freeing stdin for the payload.
 *
 * This client mirrors PrivyClient as the "external signing source transport"
 * precedent: it lives in core/clients/ and handles only transport + envelope
 * parsing, not signing logic (that's the adapter's job).
 */

import { spawn } from 'node:child_process'
import { z } from 'zod'

import { WalletCliExecutionError, WalletCliNotFoundError, WalletCliUsageError } from '../errors.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WalletCliClientOptions {
  /** Override the wallet-cli binary path/name (default: auto-resolve). */
  binary?: string
  /** Per-call timeout in ms (default: 60000, matching wallet-cli). */
  timeoutMs?: number
  /** Environment for the subprocess (default: process.env). */
  env?: NodeJS.ProcessEnv
}

export interface WalletCliResult<T> {
  success: boolean
  command: string
  data?: T
  error?: { code: string; message: string; details?: unknown }
  chain?: { family: string; network: string; chainId: string }
  meta?: { durationMs: number; warnings: string[] }
}

// ---------------------------------------------------------------------------
// Envelope schema (wallet-cli.result.v1)
// ---------------------------------------------------------------------------

const ResultEnvelopeSchema = z.object({
  schema: z.literal('wallet-cli.result.v1'),
  success: z.boolean(),
  command: z.string(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    })
    .optional(),
  meta: z
    .object({
      durationMs: z.number(),
      warnings: z.array(z.string()),
    })
    .optional(),
  chain: z
    .object({
      family: z.string(),
      network: z.string(),
      chainId: z.string(),
    })
    .optional(),
})

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const ENV_WALLET_CLI_PATH = 'AGENT_WALLET_WALLET_CLI_PATH'
const DEFAULT_TIMEOUT_MS = 60_000
const MIN_NODE_MAJOR = 20

export class WalletCliClient {
  private readonly options: WalletCliClientOptions
  private binaryResolved = false
  private cachedBinary: string | null = null

  constructor(options?: WalletCliClientOptions) {
    this.options = options ?? {}
  }

  // --- Signing / address methods (used by WalletCliSigner) ---

  async currentAccount(accountRef?: string): Promise<WalletCliResult<WalletCliCurrentAccountData>> {
    const args = ['current', '-o', 'json']
    if (accountRef) args.push('--account', accountRef)
    return this.run(args)
  }

  async signTransaction(
    transactionJson: string,
    password: string,
    accountRef?: string,
  ): Promise<WalletCliResult<WalletCliTxSignData>> {
    const args = ['tx', 'sign', '--transaction', transactionJson, '--password-stdin', '-o', 'json']
    if (accountRef) args.push('--account', accountRef)
    return this.run(args, password)
  }

  async signMessage(
    message: string,
    password: string,
    accountRef?: string,
  ): Promise<WalletCliResult<WalletCliMessageSignData>> {
    const args = ['message', 'sign', '--message', message, '--password-stdin', '-o', 'json']
    if (accountRef) args.push('--account', accountRef)
    return this.run(args, password)
  }

  async signTypedData(
    typedDataJson: string,
    password: string,
    accountRef?: string,
  ): Promise<WalletCliResult<WalletCliTypedDataSignData>> {
    const args = [
      'typed-data',
      'sign',
      '--typed-data',
      typedDataJson,
      '--password-stdin',
      '-o',
      'json',
    ]
    if (accountRef) args.push('--account', accountRef)
    return this.run(args, password)
  }

  // --- Generic runner (also used by integrations/) ---

  async run<T = unknown>(args: string[], stdinPayload?: string): Promise<WalletCliResult<T>> {
    const binary = this.resolveBinary()
    this.checkNodeVersion()

    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const env = this.options.env ?? process.env

    return new Promise<WalletCliResult<T>>((resolve, reject) => {
      const child = spawn(binary, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let timedOut = false

      let killTimer: NodeJS.Timeout | undefined
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        // Escalate to SIGKILL if the child ignores SIGTERM
        killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
      }, timeoutMs)

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

      // Guard against EPIPE when the child exits before stdin finishes writing
      child.stdin?.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer)
        clearTimeout(killTimer)
        reject(err)
      })

      // Write stdin payload (password, signed tx) then close
      if (stdinPayload !== undefined) {
        child.stdin.write(stdinPayload)
      }
      child.stdin.end()

      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer)
        clearTimeout(killTimer)
        if (err.code === 'ENOENT') {
          reject(
            new WalletCliNotFoundError(
              `wallet-cli binary not found. Install it: npm i -g @tron-walletcli/wallet-cli`,
            ),
          )
          return
        }
        reject(err)
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        clearTimeout(killTimer)
        const stdout = Buffer.concat(stdoutChunks).toString('utf-8')
        const stderr = Buffer.concat(stderrChunks).toString('utf-8')

        let envelope: z.infer<typeof ResultEnvelopeSchema>
        try {
          const parsed = JSON.parse(stdout)
          envelope = ResultEnvelopeSchema.parse(parsed)
        } catch {
          reject(
            new WalletCliExecutionError(
              `wallet-cli returned invalid output: ${stderr || stdout.slice(0, 500)}`,
              'internal_error',
            ),
          )
          return
        }

        if (code === 0 && envelope.success) {
          resolve(envelope as WalletCliResult<T>)
          return
        }

        if (timedOut) {
          reject(
            new WalletCliExecutionError(
              envelope.error?.message ?? 'wallet-cli timed out',
              'timeout',
            ),
          )
          return
        }

        const errorCode = envelope.error?.code ?? 'internal_error'
        const errorMsg = envelope.error?.message ?? 'wallet-cli failed'

        if (code === 2) {
          reject(new WalletCliUsageError(errorMsg, errorCode))
        } else {
          // code === 1 or any non-zero: execution failure
          reject(new WalletCliExecutionError(errorMsg, errorCode))
        }
      })
    })
  }

  // --- Binary resolution ---

  private resolveBinary(): string {
    if (this.binaryResolved) {
      if (!this.cachedBinary) {
        throw new WalletCliNotFoundError(
          'wallet-cli binary not found. Install it: npm i -g @tron-walletcli/wallet-cli',
        )
      }
      return this.cachedBinary
    }

    this.binaryResolved = true

    // 1. Explicit override
    if (this.options.binary) {
      this.cachedBinary = this.options.binary
      return this.cachedBinary
    }

    // 2. Environment variable
    const envPath = this.options.env?.[ENV_WALLET_CLI_PATH] ?? process.env[ENV_WALLET_CLI_PATH]
    if (envPath && envPath.trim()) {
      this.cachedBinary = envPath.trim()
      return this.cachedBinary
    }

    // 3. Default: assume on PATH
    this.cachedBinary = 'wallet-cli'
    return this.cachedBinary
  }

  private checkNodeVersion(): void {
    const major = parseInt(process.version.slice(1).split('.')[0], 10)
    if (major < MIN_NODE_MAJOR) {
      throw new WalletCliExecutionError(
        `agent-wallet runtime requires Node.js >=${MIN_NODE_MAJOR} to spawn wallet-cli; current runtime is Node ${process.version}`,
        'unsupported_runtime',
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Result data shapes (typed interfaces for each command)
// ---------------------------------------------------------------------------

export interface WalletCliCurrentAccountData {
  accountId: string
  label: string
  type: string
  index: number | null
  active: boolean
  addresses: { tron: string; evm?: string }
  seedId?: string
}

export interface WalletCliTxSignData {
  kind: string
  mode: string
  address: string
  txId: string
  signed: Record<string, unknown> & { signature: string[] }
}

export interface WalletCliMessageSignData {
  address: string
  message: string
  signature: string
}

export interface WalletCliTypedDataSignData {
  address: string
  primaryType: string
  digest: string
  signature: string
}
