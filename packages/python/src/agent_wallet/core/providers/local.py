"""Local wallet provider implementation."""

from __future__ import annotations

from pathlib import Path

from agent_wallet.core.base import BaseWallet, WalletType
from agent_wallet.core.errors import WalletNotFoundError
from agent_wallet.core.providers.base import WalletProvider
from agent_wallet.local.config import (
    WalletConfig,
    WalletInfo,
    load_config,
    save_config,
)
from agent_wallet.local.kv_store import SecureKVStore


class LocalWalletProvider(WalletProvider):
    """Local mode: decrypt all wallets at init from secrets/ directory."""

    def __init__(self, secrets_dir: str | Path, password: str) -> None:
        self._secrets_dir = secrets_dir
        kv_store = SecureKVStore(secrets_dir, password)
        kv_store.verify_password()
        self._config = load_config(secrets_dir)
        self._wallets: dict[str, BaseWallet] = {}
        for wid, conf in self._config.wallets.items():
            self._wallets[wid] = _create_wallet(conf, kv_store)

    async def list_wallets(self) -> list[WalletInfo]:
        return [
            WalletInfo(id=wid, type=conf.type)
            for wid, conf in self._config.wallets.items()
        ]

    async def get_wallet(self, wallet_id: str) -> BaseWallet:
        if wallet_id not in self._wallets:
            raise WalletNotFoundError(f"Wallet '{wallet_id}' not found")
        return self._wallets[wallet_id]

    def get_active_id(self) -> str | None:
        return self._config.active_wallet

    async def get_active_wallet(self) -> BaseWallet:
        active_id = self.get_active_id()
        if not active_id:
            raise WalletNotFoundError(
                "No active wallet set. Use 'agent-wallet use <id>' to set one."
            )
        return await self.get_wallet(active_id)

    async def get_active(self) -> BaseWallet:
        """Backward-compatible alias for older SDK callers."""
        return await self.get_active_wallet()

    def set_active(self, wallet_id: str) -> None:
        if wallet_id not in self._wallets:
            raise WalletNotFoundError(f"Wallet '{wallet_id}' not found")
        self._config.active_wallet = wallet_id
        save_config(self._secrets_dir, self._config)


def _create_wallet(conf: WalletConfig, kv_store: SecureKVStore) -> BaseWallet:
    """Instantiate the correct wallet adapter based on config type."""
    match conf.type:
        case WalletType.EVM_LOCAL:
            from agent_wallet.core.adapters.evm import EvmWallet

            assert conf.identity_file is not None
            private_key = kv_store.load_private_key(conf.identity_file)
            return EvmWallet(private_key=private_key)

        case WalletType.TRON_LOCAL:
            from agent_wallet.core.adapters.tron import TronWallet

            assert conf.identity_file is not None
            private_key = kv_store.load_private_key(conf.identity_file)
            return TronWallet(private_key=private_key)

        case _:
            raise ValueError(f"Unknown or unimplemented wallet type: {conf.type}")
