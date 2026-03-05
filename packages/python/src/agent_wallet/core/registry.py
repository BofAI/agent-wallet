"""Backwards-compatible aliases — use provider.py directly for new code."""

from agent_wallet.core.provider import (
    LocalWalletProvider,
    RemoteWalletProvider,
    WalletProvider,
    WalletFactory,
)

# Legacy aliases
WalletRegistry = WalletFactory
create_provider = WalletFactory

__all__ = [
    "WalletProvider",
    "LocalWalletProvider",
    "RemoteWalletProvider",
    "WalletFactory",
    "WalletRegistry",
    "create_provider",
]
