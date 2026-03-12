"""Provider base interfaces."""

from __future__ import annotations

from abc import ABC, abstractmethod

from agent_wallet.core.base import BaseWallet


class WalletProvider(ABC):
    """Abstract interface for resolving a signable wallet."""

    @abstractmethod
    async def get_active_wallet(self) -> BaseWallet:
        """Return the wallet instance that callers should use for signing."""
