"""AgentWallet — Universal multi-chain secure signing SDK."""

from agent_wallet.core.base import BaseWallet, Eip712Capable, WalletType
from agent_wallet.core.errors import (
    DecryptionError,
    NetworkError,
    SigningError,
    UnsupportedOperationError,
    WalletError,
    WalletNotFoundError,
)
from agent_wallet.core.providers import (
    CreateWalletProviderOptions,
    EnvProviderOptions,
    LocalProviderOptions,
    LocalWalletProvider,
    MnemonicProviderOptions,
    PrivateKeyProviderOptions,
    StaticWalletProvider,
    WalletProvider,
    create_wallet_provider,
    resolve_wallet_provider,
)

__all__ = [
    "BaseWallet",
    "CreateWalletProviderOptions",
    "DecryptionError",
    "Eip712Capable",
    "EnvProviderOptions",
    "LocalProviderOptions",
    "LocalWalletProvider",
    "MnemonicProviderOptions",
    "NetworkError",
    "PrivateKeyProviderOptions",
    "SigningError",
    "StaticWalletProvider",
    "UnsupportedOperationError",
    "WalletError",
    "WalletNotFoundError",
    "WalletProvider",
    "WalletType",
    "create_wallet_provider",
    "resolve_wallet_provider",
]
