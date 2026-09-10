import { Network, WalletType } from './base.js'
import type { RawSecretMnemonicParams, RawSecretPrivateKeyParams, WalletConfig } from './config.js'
import { decodePrivateKey, deriveKeyFromMnemonic } from './utils/keys.js'
import { EvmSigner } from './adapters/evm.js'
import { TronSigner } from './adapters/tron.js'
import { createAdapter } from './providers/wallet-builder.js'
import type { WalletDependencies } from './providers/wallet-builder.js'
import { WalletCliConfigResolver } from './providers/wallet-cli-config.js'
import { WalletCliClient } from './clients/wallet-cli.js'
import { WalletCliExecutionError } from './errors.js'

export type AddressEntry = {
  format: 'eip155' | 'tron'
  label: 'EVM' | 'TRON'
  address: string
}

export type AddressResolutionResult =
  | {
      mode: 'single'
      entries: [{ format: 'canonical'; label: 'Address'; address: string }]
    }
  | {
      mode: 'whitelist'
      entries: [AddressEntry, AddressEntry]
    }

export async function resolveWalletAddresses(
  conf: WalletConfig,
  options?: { dependencies?: WalletDependencies },
): Promise<AddressResolutionResult> {
  if (conf.type === WalletType.WALLET_CLI) {
    return resolveWalletCliAddresses(conf, options?.dependencies)
  }
  if (conf.type === WalletType.PRIVY) {
    return resolveExternalSignerAddress(conf, options?.dependencies)
  }

  const privateKey = loadRawSecretPrivateKey(conf.params)

  const [evmAddress, tronAddress] = await Promise.all([
    new EvmSigner(privateKey.eip155, 'eip155:1').getAddress(),
    new TronSigner(privateKey.tron, 'tron:728126428').getAddress(),
  ])

  return {
    mode: 'whitelist',
    entries: [
      { format: 'eip155', label: 'EVM', address: evmAddress },
      { format: 'tron', label: 'TRON', address: tronAddress },
    ],
  }
}

/**
 * Resolve address for external signers (privy, wallet_cli) by delegating to
 * the shared createAdapter registry — same construction path as signing,
 * so future builder changes apply here automatically.
 */
async function resolveExternalSignerAddress(
  conf: WalletConfig,
  dependencies?: WalletDependencies,
): Promise<AddressResolutionResult> {
  const wallet = await createAdapter(conf, '', undefined, dependencies)
  const address = await wallet.getAddress()
  return {
    mode: 'single',
    entries: [{ format: 'canonical', label: 'Address', address }],
  }
}

async function resolveWalletCliAddresses(
  conf: Extract<WalletConfig, { type: 'wallet_cli' }>,
  dependencies?: WalletDependencies,
): Promise<AddressResolutionResult> {
  const resolver = new WalletCliConfigResolver({
    source: conf.params,
  })
  const config = await resolver.resolve()
  const client =
    dependencies?.walletCli?.clientFactory?.({ purpose: 'address-resolution' }) ??
    new WalletCliClient()
  const result = await client.currentAccount(config.account)
  const { evm, tron } = result.data.addresses

  if (evm && tron) {
    return {
      mode: 'whitelist',
      entries: [
        { format: 'eip155', label: 'EVM', address: evm },
        { format: 'tron', label: 'TRON', address: tron },
      ],
    }
  }
  const address = evm ?? tron
  if (!address) {
    throw new WalletCliExecutionError(
      `wallet-cli account '${result.data.accountId}' returned no supported address`,
      'contract_mismatch',
    )
  }
  return {
    mode: 'single',
    entries: [{ format: 'canonical', label: 'Address', address }],
  }
}

function loadRawSecretPrivateKey(params: RawSecretPrivateKeyParams | RawSecretMnemonicParams): {
  eip155: Uint8Array
  tron: Uint8Array
} {
  if (params.source === 'private_key') {
    const privateKey = decodePrivateKey(params.private_key)
    return { eip155: privateKey, tron: privateKey }
  }

  return {
    eip155: deriveKeyFromMnemonic(Network.EVM, params.mnemonic, params.account_index),
    tron: deriveKeyFromMnemonic(Network.TRON, params.mnemonic, params.account_index),
  }
}
