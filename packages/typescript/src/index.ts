// Core types
export { Network, WalletType } from './core/base.js'
export type {
  Wallet,
  Eip712Capable,
  MessageSigningCapable,
  WalletProvider,
  SignOptions,
} from './core/base.js'

// Error classes
export {
  WalletError,
  WalletNotFoundError,
  DecryptionError,
  InsufficientBalanceError,
  SigningError,
  NetworkError,
  UnsupportedOperationError,
  PrivyConfigError,
  PrivyRequestError,
  PrivyRateLimitError,
  PrivyAuthError,
  ExternalSignerError,
  ExternalSignerConfigError,
  ExternalSignerExecutionError,
  ExternalSignerUsageError,
  ExternalSignerNotFoundError,
  WalletCliConfigError,
  WalletCliNotFoundError,
  WalletCliUsageError,
  WalletCliExecutionError,
} from './core/errors.js'

// Wallet adapters
export { EvmSigner } from './core/adapters/evm.js'
export { TronSigner } from './core/adapters/tron.js'
export { LocalSigner } from './core/adapters/local.js'
export { RawSecretSigner } from './core/adapters/raw-secret.js'
export { PrivyAdapter } from './core/adapters/privy.js'
export { WalletCliAdapter } from './core/adapters/wallet-cli.js'

// Provider layer
export { ConfigWalletProvider, EnvWalletProvider } from './core/providers/index.js'
export { ExternalSignerConfigResolver } from './core/providers/external-signer-config.js'
export { WalletCliConfigResolver } from './core/providers/wallet-cli-config.js'
export type { WalletCliConfig, WalletCliConfigSource } from './core/providers/wallet-cli-config.js'

// Secret resolver
export type { SecretRef, SecretValue } from './core/secret-resolver.js'
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

// Resolver
export { resolveWallet, resolveWalletProvider } from './core/resolver.js'
export type { ResolvedWalletProvider } from './core/resolver.js'

// Config types and functions
export { loadConfig, saveConfig } from './core/config.js'
export type {
  WalletConfig,
  WalletsTopology,
  RawSecretPrivateKeyParams,
  RawSecretMnemonicParams,
  RawSecretParams,
  PrivyWalletParams,
  WalletCliWalletParams,
} from './core/config.js'
export { PrivyConfigResolver } from './core/providers/privy-config.js'
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
  WalletCliMessageSignData,
  WalletCliTypedDataSignData,
} from './core/clients/wallet-cli.js'
export {
  registerExternalSigner,
  isRegisteredExternalSigner,
} from './core/providers/wallet-builder.js'
export type {
  ExternalSignerBuilder,
  WalletDependencies,
  WalletCliDependencies,
} from './core/providers/wallet-builder.js'
export { parseWalletCliNetwork, assertTronWalletCliNetwork } from './core/wallet-cli-network.js'
export type { WalletCliNetworkTarget, WalletCliFamily } from './core/wallet-cli-network.js'
