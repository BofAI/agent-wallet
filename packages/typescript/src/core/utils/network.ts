import { Network } from '../base.js'

export function parseNetworkFamily(network: string | undefined): Network {
  const normalized = network?.trim().toLowerCase()
  if (!normalized) throw new Error('network is required')
  if (normalized === 'tron' || normalized.startsWith('tron:')) return Network.TRON
  if (normalized === 'eip155' || normalized.startsWith('eip155:')) return Network.EVM
  throw new Error("network must start with 'tron' or 'eip155'")
}

export function resolveNetwork(
  explicit: string | undefined,
  providerDefault: string | undefined,
): string | undefined {
  if (explicit) return explicit
  if (providerDefault) return providerDefault
  return undefined
}
