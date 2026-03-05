"""WalletProvider — abstract interface and concrete implementations."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

from agent_wallet.core.base import BaseWallet, WalletType
from agent_wallet.core.errors import WalletNotFoundError
from agent_wallet.secret.kv_store import SecureKVStore
from agent_wallet.storage.config import (
    WalletConfig,
    WalletInfo,
    WalletsTopology,
    load_config,
)


class WalletProvider(ABC):
    """Abstract interface for wallet management.

    All providers expose the same two operations:
    - list_wallets(): discover available wallets
    - get_wallet(id): obtain a BaseWallet instance for signing
    """

    @abstractmethod
    async def list_wallets(self) -> list[WalletInfo]:
        """Return summaries of all configured wallets."""

    @abstractmethod
    async def get_wallet(self, wallet_id: str) -> BaseWallet:
        """Return a wallet instance by ID."""


class LocalWalletProvider(WalletProvider):
    """Local mode: decrypt all wallets at init from secrets/ directory.

    After initialization, the password is discarded and not held in memory.
    """

    def __init__(self, secrets_dir: str | Path, password: str) -> None:
        kv_store = SecureKVStore(secrets_dir, password)
        kv_store.verify_password()
        self._config = load_config(secrets_dir)
        self._wallets: dict[str, BaseWallet] = {}
        for wid, conf in self._config.wallets.items():
            self._wallets[wid] = _create_wallet(conf, kv_store)
        # kv_store (and password ref within it) goes out of scope here

    async def list_wallets(self) -> list[WalletInfo]:
        return [
            WalletInfo(id=wid, type=conf.type, chain_id=conf.chain_id)
            for wid, conf in self._config.wallets.items()
        ]

    async def get_wallet(self, wallet_id: str) -> BaseWallet:
        if wallet_id not in self._wallets:
            raise WalletNotFoundError(f"Wallet '{wallet_id}' not found")
        return self._wallets[wallet_id]


class RemoteWalletProvider(WalletProvider):
    """Remote mode: proxy all operations to a remote agent-wallet server via HTTP."""

    def __init__(self, remote_url: str, token: Optional[str] = None) -> None:
        self._remote_url = remote_url.rstrip("/")
        self._token = token

    async def list_wallets(self) -> list[WalletInfo]:
        # TODO: GET {remote_url}/wallets
        raise NotImplementedError("Remote list_wallets not yet implemented")

    async def get_wallet(self, wallet_id: str) -> BaseWallet:
        from agent_wallet.core.adapters.remote import RemoteWallet

        return RemoteWallet(
            remote_url=self._remote_url,
            wallet_id=wallet_id,
            token=self._token,
        )


def WalletFactory(
    *,
    secrets_dir: Optional[str | Path] = None,
    password: Optional[str] = None,
    remote_url: Optional[str] = None,
    token: Optional[str] = None,
) -> WalletProvider:
    """Factory — create the appropriate provider from arguments."""
    if remote_url:
        return RemoteWalletProvider(remote_url, token=token)
    if secrets_dir:
        if password is None:
            raise ValueError("password is required for Local mode")
        return LocalWalletProvider(secrets_dir, password)
    raise ValueError("Either secrets_dir+password or remote_url is required")


def _create_wallet(conf: WalletConfig, kv_store: SecureKVStore) -> BaseWallet:
    """Instantiate the correct wallet adapter based on config type."""
    match conf.type:
        case WalletType.EVM_LOCAL:
            from agent_wallet.core.adapters.evm import EvmWallet

            assert conf.identity_file is not None
            private_key = kv_store.load_private_key(conf.identity_file)
            return EvmWallet(private_key=private_key, chain_id=conf.chain_id)

        case WalletType.TRON_LOCAL:
            from agent_wallet.core.adapters.tron import TronWallet

            assert conf.identity_file is not None
            private_key = kv_store.load_private_key(conf.identity_file)
            return TronWallet(
                private_key=private_key,
                chain_id=conf.chain_id,
            )

        case WalletType.REMOTE:
            from agent_wallet.core.adapters.remote import RemoteWallet

            assert conf.remote_url is not None
            token = None
            if conf.cred_file:
                token = kv_store.load_credential(conf.cred_file)
            return RemoteWallet(
                remote_url=conf.remote_url,
                token=token,
            )

        case _:
            raise ValueError(f"Unknown or unimplemented wallet type: {conf.type}")
