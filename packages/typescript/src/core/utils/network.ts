import { Network } from '../base.js'
import { NetworkError } from '../errors.js'

const CANONICAL_NETWORK = /^(tron|eip155):([1-9]\d{0,31})$/

export interface CanonicalNetwork {
  family: Network
  id: string
  chainId: string
}

/** Parse the canonical CAIP-2 forms supported by agent-wallet. */
export function parseCanonicalNetwork(network: string | undefined): CanonicalNetwork {
  if (!network) {
    throw new NetworkError(
      'network is required and must use canonical CAIP-2: tron:<chainId> or eip155:<chainId>',
    )
  }

  const match = CANONICAL_NETWORK.exec(network)
  if (!match) {
    throw new NetworkError(
      `Invalid network '${network}'. Use canonical CAIP-2 tron:<positive chainId> or eip155:<positive chainId>; aliases, bare families, whitespace, and case variants are not accepted.`,
    )
  }

  const [, namespace, chainId] = match
  return {
    family: namespace === 'tron' ? Network.TRON : Network.EVM,
    id: network,
    chainId,
  }
}

export function parseNetworkFamily(network: string | undefined): Network {
  return parseCanonicalNetwork(network).family
}

export function assertNetworkFamily(network: string, expected: Network): CanonicalNetwork {
  const parsed = parseCanonicalNetwork(network)
  if (parsed.family !== expected) {
    const namespace = expected === Network.TRON ? 'tron' : 'eip155'
    throw new NetworkError(`network must use the canonical ${namespace}:<chainId> family`)
  }
  return parsed
}

export function resolveNetwork(
  explicit: string | undefined,
  providerDefault: string | undefined,
): string | undefined {
  const network = explicit ?? providerDefault
  if (network !== undefined) parseCanonicalNetwork(network)
  return network
}
