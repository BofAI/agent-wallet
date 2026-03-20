/**
 * Storage layer: wallets_config.json loading and validation.
 *
 * JSON keys use snake_case to match the Python implementation exactly,
 * ensuring cross-language config file compatibility.
 */

import { chmodSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { WALLETS_CONFIG_FILENAME, RUNTIME_SECRETS_FILENAME } from './constants.js'

export class ConfigNotFoundError extends Error {
  constructor(path: string) {
    super(`Config not found: ${path}`)
    this.name = 'ConfigNotFoundError'
  }
}

// ---------------------------------------------------------------------------
// Zod schemas — params models
// ---------------------------------------------------------------------------

export const LocalSecureWalletParamsSchema = z.object({
  secret_ref: z.string(),
})

export const RawSecretPrivateKeyParamsSchema = z.object({
  source: z.literal('private_key'),
  private_key: z.string(),
})

export const RawSecretMnemonicParamsSchema = z.object({
  source: z.literal('mnemonic'),
  mnemonic: z.string(),
  account_index: z.number().int().nonnegative().default(0),
})

export const RawSecretParamsSchema = z.discriminatedUnion('source', [
  RawSecretPrivateKeyParamsSchema,
  RawSecretMnemonicParamsSchema,
])

// ---------------------------------------------------------------------------
// Zod schemas — WalletConfig (unified type + params)
// ---------------------------------------------------------------------------

export const WalletConfigSchema = z
  .object({
    type: z.enum(['local_secure', 'raw_secret']),
    params: z.union([LocalSecureWalletParamsSchema, RawSecretParamsSchema]),
  })
  .refine(
    (data) => {
      if (data.type === 'local_secure') return 'secret_ref' in data.params
      if (data.type === 'raw_secret') return 'source' in data.params
      return false
    },
    { message: 'params must match wallet type' },
  )

export const WalletsTopologySchema = z.object({
  active_wallet: z.string().nullable().optional().default(null),
  wallets: z.record(z.string(), WalletConfigSchema),
})

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type LocalSecureWalletParams = z.infer<typeof LocalSecureWalletParamsSchema>
export type RawSecretPrivateKeyParams = z.infer<typeof RawSecretPrivateKeyParamsSchema>
export type RawSecretMnemonicParams = z.infer<typeof RawSecretMnemonicParamsSchema>
export type RawSecretParams = z.infer<typeof RawSecretParamsSchema>
export type WalletConfig = z.infer<typeof WalletConfigSchema>
export type WalletsTopology = z.infer<typeof WalletsTopologySchema>

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function loadConfig(secretsDir: string): WalletsTopology {
  const path = join(secretsDir, WALLETS_CONFIG_FILENAME)
  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ConfigNotFoundError(path)
    }
    throw error
  }
  const data = JSON.parse(text) as Record<string, unknown>
  return WalletsTopologySchema.parse(data)
}

export function saveConfig(secretsDir: string, config: WalletsTopology): void {
  const path = join(secretsDir, WALLETS_CONFIG_FILENAME)
  const data = stripNullish(config)
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8')
  try {
    chmodSync(path, 0o600)
  } catch {
    // ignore on platforms without chmod support
  }
}

export function loadRuntimeSecretsPassword(secretsDir: string): string | null {
  const path = join(secretsDir, RUNTIME_SECRETS_FILENAME)
  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    return null
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new Error(`Invalid JSON in ${RUNTIME_SECRETS_FILENAME}: ${(error as Error).message}`, {
      cause: error,
    })
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${RUNTIME_SECRETS_FILENAME} must contain a JSON object`)
  }

  const password = (data as Record<string, unknown>).password
  if (password === undefined || password === null) return null
  if (typeof password !== 'string') {
    throw new Error(`${RUNTIME_SECRETS_FILENAME}.password must be a string`)
  }

  const normalized = password.trim()
  return normalized || null
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stripNullish(obj: unknown): unknown {
  if (obj === null || obj === undefined) return undefined
  if (Array.isArray(obj)) return obj.map(stripNullish)
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value !== undefined && value !== null) {
        result[key] = stripNullish(value)
      }
    }
    return result
  }
  return obj
}
