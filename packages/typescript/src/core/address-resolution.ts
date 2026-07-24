import { Network, WalletType } from './base.js'
import type {
  RawSecretMnemonicParams,
  RawSecretPrivateKeyParams,
  WalletConfig,
} from './config.js'
import { decodePrivateKey, deriveKeyFromMnemonic } from './utils/keys.js'
import { EvmSigner } from './adapters/evm.js'
import { TronSigner } from './adapters/tron.js'
import { createAdapter } from './providers/wallet-builder.js'

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
): Promise<AddressResolutionResult> {
  if (conf.type === WalletType.PRIVY || conf.type === WalletType.WALLET_CLI) {
    return resolveExternalSignerAddress(conf)
  }

  const privateKey = loadRawSecretPrivateKey(
    conf.params as RawSecretPrivateKeyParams | RawSecretMnemonicParams,
  )

  const [evmAddress, tronAddress] = await Promise.all([
    new EvmSigner(privateKey.eip155, 'eip155').getAddress(),
    new TronSigner(privateKey.tron, 'tron').getAddress(),
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
async function resolveExternalSignerAddress(conf: WalletConfig): Promise<AddressResolutionResult> {
  const wallet = await createAdapter(conf, '', undefined)
  const address = await wallet.getAddress()
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
