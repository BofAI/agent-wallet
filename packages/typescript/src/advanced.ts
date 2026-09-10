/** Advanced adapter, transport, and secret-lifecycle APIs. */

export { EvmSigner } from './core/adapters/evm.js'
export { TronSigner } from './core/adapters/tron.js'
export { LocalSigner } from './core/adapters/local.js'
export { RawSecretSigner } from './core/adapters/raw-secret.js'
export { PrivyAdapter } from './core/adapters/privy.js'
export { WalletCliAdapter } from './core/adapters/wallet-cli.js'

export { ExternalSignerConfigResolver } from './core/providers/external-signer-config.js'
export { PrivyConfigResolver } from './core/providers/privy-config.js'
export { WalletCliConfigResolver } from './core/providers/wallet-cli-config.js'
export type { WalletCliConfig, WalletCliConfigSource } from './core/providers/wallet-cli-config.js'

export { PrivyClient } from './core/clients/privy.js'
export { WalletCliClient } from './core/clients/wallet-cli.js'
export type {
  WalletCliClientOptions,
  WalletCliResult,
  WalletCliSuccessResult,
  WalletCliFailureResult,
  WalletCliWarning,
  WalletCliLaunchTarget,
  WalletCliRunContract,
  WalletCliCompatibility,
  WalletCliCatalog,
  WalletCliCatalogCommand,
  WalletCliNetworkRow,
  WalletCliCurrentAccountData,
  WalletCliTxSignData,
  WalletCliTronTxSignData,
  WalletCliEvmTxSignData,
  WalletCliTypedDataSignData,
} from './core/clients/wallet-cli.js'

export { resolveSecret, isSecretRef, DEFAULT_EXEC_TIMEOUT_MS } from './core/secret-resolver.js'
export {
  StaticSecretProvider,
  ExecSecretProvider,
  defaultSecretProviderFactory,
  DEFAULT_SECRET_STDOUT_LIMIT,
  DEFAULT_SECRET_STDERR_LIMIT,
} from './core/secret-provider.js'
export type {
  SecretProvider,
  SecretLease,
  SecretProviderFactory,
  SecretContext,
  ExecSecretProviderOptions,
} from './core/secret-provider.js'

export { parseWalletCliNetwork, assertTronWalletCliNetwork } from './core/wallet-cli-network.js'
export type { WalletCliNetworkTarget, WalletCliFamily } from './core/wallet-cli-network.js'
export type { ExternalSignerBuilder } from './core/providers/wallet-builder.js'
