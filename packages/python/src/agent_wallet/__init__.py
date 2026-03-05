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
from agent_wallet.core.provider import (
    LocalWalletProvider,
    RemoteWalletProvider,
    WalletProvider,
    WalletFactory,
)

__all__ = [
    "WalletType",
    "WalletProvider",
    "LocalWalletProvider",
    "RemoteWalletProvider",
    "WalletFactory",
    "BaseWallet",
    "Eip712Capable",
    "WalletError",
    "WalletNotFoundError",
    "DecryptionError",
    "SigningError",
    "NetworkError",
    "UnsupportedOperationError",
]
