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
    LocalWalletProvider,
    StaticWalletProvider,
    WalletProvider,
    resolve_wallet_provider,
)

__all__ = [
    "BaseWallet",
    "DecryptionError",
    "Eip712Capable",
    "LocalWalletProvider",
    "NetworkError",
    "SigningError",
    "StaticWalletProvider",
    "UnsupportedOperationError",
    "WalletError",
    "WalletNotFoundError",
    "WalletProvider",
    "WalletType",
    "resolve_wallet_provider",
]
