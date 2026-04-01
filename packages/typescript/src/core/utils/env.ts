export function cleanEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

export function firstEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = cleanEnvValue(env[key])
    if (value !== undefined) return value
  }
  return undefined
}

export function parseAccountIndex(value: string | undefined): number {
  const normalized = value?.trim()
  if (!normalized) return 0
  if (!/^\d+$/.test(normalized)) {
    throw new Error('AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX must be a non-negative integer')
  }
  return Number(normalized)
}
