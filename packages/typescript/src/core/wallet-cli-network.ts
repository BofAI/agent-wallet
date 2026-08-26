import { NetworkError } from './errors.js'

export type WalletCliFamily = 'tron' | 'evm'

export interface WalletCliNetworkTarget {
  family: WalletCliFamily
  agentNetwork: string
  cliNetwork: string
  requestedChainId?: string
}

const TRON_NETWORK = /^tron:([a-z0-9][a-z0-9_-]*)$/
const EIP155_NETWORK = /^eip155:([1-9]\d*)$/

/** Parse the only network forms accepted by the wallet-cli signing adapter. */
export function parseWalletCliNetwork(network: string | undefined): WalletCliNetworkTarget {
  const normalized = network?.trim().toLowerCase()
  if (!normalized) {
    throw new NetworkError(
      'wallet_cli requires a complete network: tron:<name> or eip155:<chainId>',
    )
  }

  const tron = TRON_NETWORK.exec(normalized)
  if (tron) {
    return {
      family: 'tron',
      agentNetwork: normalized,
      cliNetwork: normalized,
    }
  }

  const evm = EIP155_NETWORK.exec(normalized)
  if (evm) {
    const chainId = evm[1]
    const numericChainId = Number(chainId)
    if (!Number.isSafeInteger(numericChainId) || numericChainId <= 0) {
      throw new NetworkError(`wallet_cli EVM chainId is outside the safe integer range: ${chainId}`)
    }
    return {
      family: 'evm',
      agentNetwork: normalized,
      cliNetwork: `evm:${chainId}`,
      requestedChainId: chainId,
    }
  }

  throw new NetworkError(
    `Invalid wallet_cli network '${network}'. Use tron:<name> or eip155:<positive chainId>; aliases and bare families are not accepted.`,
  )
}

export function assertTronWalletCliNetwork(network: string): WalletCliNetworkTarget {
  const target = parseWalletCliNetwork(network)
  if (target.family !== 'tron') {
    throw new NetworkError('integrations/wallet-cli is TRON-only; use a tron:<name> network')
  }
  return target
}
