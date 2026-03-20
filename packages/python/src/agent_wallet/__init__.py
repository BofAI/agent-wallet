"""AgentWallet — Universal multi-chain secure signing SDK."""

from agent_wallet.core.base import Eip712Capable, Network, Wallet, WalletType
from agent_wallet.core.errors import (
    DecryptionError,
    NetworkError,
    SigningError,
    UnsupportedOperationError,
    WalletError,
    WalletNotFoundError,
)
from agent_wallet.core.providers import (
    ConfigWalletProvider,
    EnvWalletProvider,
)
from agent_wallet.core.resolver import resolve_wallet, resolve_wallet_provider

__all__ = [
    "ConfigWalletProvider",
    "DecryptionError",
    "Eip712Capable",
    "EnvWalletProvider",
    "EvmAdapter",
    "Network",
    "NetworkError",
    "SigningError",
    "TronAdapter",
    "UnsupportedOperationError",
    "Wallet",
    "WalletError",
    "WalletNotFoundError",
    "WalletType",
    "resolve_wallet",
    "resolve_wallet_provider",
]


def __getattr__(name: str):
    if name == "EvmAdapter":
        from agent_wallet.core.adapters.evm import EvmAdapter

        return EvmAdapter
    if name == "TronAdapter":
        from agent_wallet.core.adapters.tron import TronAdapter

        return TronAdapter
    raise AttributeError(f"module 'agent_wallet' has no attribute {name!r}")
