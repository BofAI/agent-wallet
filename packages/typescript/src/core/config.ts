/**
 * Storage layer: wallets_config.json loading and validation.
 *
 * JSON keys use snake_case for consistency with the on-disk config format.
 */

import { chmodSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { WALLETS_CONFIG_FILENAME } from './constants.js'
import type { SecretRef, SecretValue } from './secret-resolver.js'

export class ConfigNotFoundError extends Error {
  constructor(path: string) {
    super(`Config not found: ${path}`)
    this.name = 'ConfigNotFoundError'
  }
}

// ---------------------------------------------------------------------------
// Zod schemas — params models

export const SecretRefSchema = z.object({
  exec: z.string(),
  timeout: z.number().int().positive().optional(),
})

export const SecretValueSchema = z.union([z.string(), SecretRefSchema])
// ---------------------------------------------------------------------------

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

export const PrivyWalletParamsSchema = z.object({
  app_id: z.string(),
  app_secret: SecretValueSchema,
  wallet_id: z.string(),
})

export const WalletCliWalletParamsSchema = z.object({
  account: z.string().optional(),
  password: SecretValueSchema,
})

// ---------------------------------------------------------------------------
// Zod schemas — WalletConfig (unified type + params)
// ---------------------------------------------------------------------------

export const WalletConfigSchema = z
  .object({
    type: z.enum(['raw_secret', 'privy', 'wallet_cli']),
    params: z.union([
      RawSecretParamsSchema,
      PrivyWalletParamsSchema,
      WalletCliWalletParamsSchema,
    ]),
  })
  .refine(
    (data) => {
      if (data.type === 'raw_secret') return 'source' in data.params
      if (data.type === 'privy') return 'app_id' in data.params
      if (data.type === 'wallet_cli') return 'password' in data.params
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

export type RawSecretPrivateKeyParams = z.infer<typeof RawSecretPrivateKeyParamsSchema>
export type RawSecretMnemonicParams = z.infer<typeof RawSecretMnemonicParamsSchema>
export type RawSecretParams = z.infer<typeof RawSecretParamsSchema>
export type PrivyWalletParams = z.infer<typeof PrivyWalletParamsSchema>
export type WalletCliWalletParams = z.infer<typeof WalletCliWalletParamsSchema>
export type { SecretRef, SecretValue }
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
