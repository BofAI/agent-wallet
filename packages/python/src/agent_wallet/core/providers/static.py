"""Static single-wallet provider implementation."""

from __future__ import annotations

from agent_wallet.core.base import BaseWallet
from agent_wallet.core.providers.base import WalletProvider


class StaticWalletProvider(WalletProvider):
    """Provider for a single in-memory wallet resolved from environment."""

    def __init__(self, wallet: BaseWallet) -> None:
        self._wallet = wallet

    async def get_active_wallet(self) -> BaseWallet:
        return self._wallet
