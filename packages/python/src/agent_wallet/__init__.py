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
    WalletFactory,
    WalletProvider,
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
    "WalletFactory",
    "WalletNotFoundError",
    "WalletProvider",
    "WalletType",
]
