import { Network, WalletType } from './base.js'
import type {
  LocalSecureWalletParams,
  PrivyWalletParams,
  RawSecretMnemonicParams,
  RawSecretPrivateKeyParams,
  WalletConfig,
} from './config.js'
import type { SecretLoaderFn } from './adapters/local-secure.js'
import { decodePrivateKey, deriveKeyFromMnemonic } from './utils/keys.js'
import { EvmSigner } from './adapters/evm.js'
import { TronSigner } from './adapters/tron.js'
import { PrivyAdapter } from './adapters/privy.js'
import { PrivyClient } from './clients/privy.js'
import { PrivyConfigResolver } from './providers/privy-config.js'

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

type ResolveAddressOptions = {
  configDir: string
  password?: string
  secretLoader?: SecretLoaderFn
}

export async function resolveWalletAddresses(
  conf: WalletConfig,
  options: ResolveAddressOptions,
): Promise<AddressResolutionResult> {
  if (conf.type === WalletType.PRIVY) {
    return resolvePrivyAddress(conf.params as PrivyWalletParams)
  }

  const privateKey =
    conf.type === WalletType.LOCAL_SECURE
      ? loadLocalSecurePrivateKey(conf.params as LocalSecureWalletParams, options)
      : loadRawSecretPrivateKey(conf.params as RawSecretPrivateKeyParams | RawSecretMnemonicParams)

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

async function resolvePrivyAddress(params: PrivyWalletParams): Promise<AddressResolutionResult> {
  const resolved = new PrivyConfigResolver({ source: params }).resolve()
  const wallet = new PrivyAdapter(
    resolved,
    new PrivyClient({
      appId: resolved.appId,
      appSecret: resolved.appSecret,
    }),
  )
  const address = await wallet.getAddress()
  return {
    mode: 'single',
    entries: [{ format: 'canonical', label: 'Address', address }],
  }
}

function loadLocalSecurePrivateKey(
  params: LocalSecureWalletParams,
  options: ResolveAddressOptions,
): { eip155: Uint8Array; tron: Uint8Array } {
  if (!options.password) {
    throw new Error('Password required for local_secure wallets')
  }
  if (!options.secretLoader) {
    throw new Error('local_secure wallets require a configured secret loader')
  }
  const privateKey = options.secretLoader(options.configDir, options.password, params.secret_ref)
  return { eip155: privateKey, tron: privateKey }
}

function loadRawSecretPrivateKey(
  params: RawSecretPrivateKeyParams | RawSecretMnemonicParams,
): { eip155: Uint8Array; tron: Uint8Array } {
  if (params.source === 'private_key') {
    const privateKey = decodePrivateKey(params.private_key)
    return { eip155: privateKey, tron: privateKey }
  }

  return {
    eip155: deriveKeyFromMnemonic(Network.EVM, params.mnemonic, params.account_index),
    tron: deriveKeyFromMnemonic(Network.TRON, params.mnemonic, params.account_index),
  }
}
