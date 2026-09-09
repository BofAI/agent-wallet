import { NetworkError } from './errors.js'
import { Network } from './base.js'
import { parseCanonicalNetwork } from './utils/network.js'

export type WalletCliFamily = 'tron' | 'evm'

export interface WalletCliNetworkTarget {
  family: WalletCliFamily
  agentNetwork: string
  cliNetwork: string
  requestedChainId: string
}

/** Parse the only network forms accepted by the wallet-cli signing adapter. */
export function parseWalletCliNetwork(network: string | undefined): WalletCliNetworkTarget {
  const parsed = parseCanonicalNetwork(network)
  if (parsed.family === Network.TRON) {
    return {
      family: 'tron',
      agentNetwork: parsed.id,
      cliNetwork: parsed.id,
      requestedChainId: parsed.chainId,
    }
  }

  const numericChainId = Number(parsed.chainId)
  if (!Number.isSafeInteger(numericChainId)) {
    throw new NetworkError(
      `wallet_cli EVM chainId is outside the safe integer range: ${parsed.chainId}`,
    )
  }
  return {
    family: 'evm',
    agentNetwork: parsed.id,
    cliNetwork: parsed.id,
    requestedChainId: parsed.chainId,
  }
}

export function assertTronWalletCliNetwork(network: string): WalletCliNetworkTarget {
  const target = parseWalletCliNetwork(network)
  if (target.family !== 'tron') {
    throw new NetworkError('integrations/wallet-cli is TRON-only; use canonical tron:<chainId>')
  }
  return target
}
