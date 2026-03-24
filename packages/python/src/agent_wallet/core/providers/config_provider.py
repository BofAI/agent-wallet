"""Config-driven wallet provider -- handles all wallet types from wallets_config.json."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

from agent_wallet.core.base import Wallet, WalletProvider, WalletType
from agent_wallet.core.config import (
    WalletConfig,
    WalletsTopology,
    load_config,
    load_runtime_secrets_password,
    save_config,
)
from agent_wallet.core.constants import RUNTIME_SECRETS_FILENAME, WALLETS_CONFIG_FILENAME
from agent_wallet.core.errors import WalletNotFoundError
from agent_wallet.core.providers.wallet_builder import (
    create_adapter,
)
from agent_wallet.core.utils import safe_chmod


class ConfigWalletProvider(WalletProvider):
    """Multi-wallet provider that reads wallets_config.json and handles all types."""

    def __init__(
        self,
        config_dir: str | Path,
        password: str | None = None,
        *,
        network: str | None = None,
        secret_loader: Callable[[str | Path, str, str], bytes] | None = None,
    ) -> None:
        self._config_dir = str(config_dir)
        self._password = password
        self._network = network
        self._secret_loader = secret_loader
        self._config_path = Path(self._config_dir) / WALLETS_CONFIG_FILENAME
        try:
            self._config = load_config(config_dir)
        except FileNotFoundError:
            self._config = WalletsTopology(wallets={})
        self._wallets: dict[str, Wallet] = {}

    def is_initialized(self) -> bool:
        return self._config_path.exists()

    def ensure_storage(self) -> None:
        self._ensure_dir()
        if not self._config_path.exists():
            self._persist()

    def list_wallets(self) -> list[tuple[str, WalletConfig, bool]]:
        return [
            (wallet_id, conf, wallet_id == self._config.active_wallet)
            for wallet_id, conf in self._config.wallets.items()
        ]

    def get_wallet_config(self, wallet_id: str) -> WalletConfig:
        if wallet_id not in self._config.wallets:
            raise WalletNotFoundError(f"Wallet '{wallet_id}' not found")
        return self._config.wallets[wallet_id]

    def get_active_id(self) -> str | None:
        return self._config.active_wallet

    def add_wallet(
        self,
        wallet_id: str,
        config: WalletConfig,
        *,
        set_active_if_missing: bool = True,
    ) -> None:
        if wallet_id in self._config.wallets:
            raise ValueError(f"Wallet '{wallet_id}' already exists")
        self._config.wallets[wallet_id] = config
        if set_active_if_missing and not self._config.active_wallet:
            self._config.active_wallet = wallet_id
        self._persist()

    def set_active(self, wallet_id: str) -> WalletConfig:
        conf = self.get_wallet_config(wallet_id)
        self._config.active_wallet = wallet_id
        self._persist()
        return conf

    def remove_wallet(self, wallet_id: str) -> WalletConfig:
        conf = self.get_wallet_config(wallet_id)
        if conf.type == WalletType.LOCAL_SECURE:
            secret_path = self._secret_path(conf.secret_ref)
            if secret_path.exists():
                secret_path.unlink()
        del self._config.wallets[wallet_id]
        if self._config.active_wallet == wallet_id:
            self._config.active_wallet = None
        self._wallets = {
            cache_key: wallet
            for cache_key, wallet in self._wallets.items()
            if not cache_key.startswith(f"{wallet_id}:")
        }
        self._persist()
        return conf

    def has_secret_file(self, wallet_id: str) -> bool:
        conf = self.get_wallet_config(wallet_id)
        if conf.type != WalletType.LOCAL_SECURE:
            return False
        return self._secret_path(conf.secret_ref).exists()

    def has_runtime_secrets(self) -> bool:
        return self._runtime_secrets_path().exists()

    def load_runtime_secrets_password(self) -> str | None:
        return load_runtime_secrets_password(self._config_dir)

    def save_runtime_secrets(self, password: str | None) -> None:
        if not password:
            return
        self._ensure_dir()
        path = self._runtime_secrets_path()
        path.write_text(
            json.dumps({"password": password}, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    async def get_wallet(self, wallet_id: str, network: str | None = None) -> Wallet:
        self.get_wallet_config(wallet_id)
        resolved_network = _resolve_network(network, self._network)
        cache_key = f"{wallet_id}:{resolved_network}"
        if cache_key not in self._wallets:
            conf = self._config.wallets[wallet_id]
            self._wallets[cache_key] = create_adapter(
                conf,
                self._config_dir,
                self._password,
                resolved_network,
                self._secret_loader,
            )
        return self._wallets[cache_key]

    async def get_active_wallet(self, network: str | None = None) -> Wallet:
        resolved_network = _resolve_network(network, self._network)
        active_id = self._config.active_wallet
        if active_id:
            return await self.get_wallet(active_id, resolved_network)

        for wallet_id, conf in self._config.wallets.items():
            if _wallet_is_available_without_password(conf, self._password):
                return await self.get_wallet(wallet_id, resolved_network)

        if self._config.wallets:
            raise ValueError("Password required for local_secure wallets")
        raise WalletNotFoundError("No active wallet set.")

    def _ensure_dir(self) -> None:
        path = Path(self._config_dir)
        path.mkdir(parents=True, exist_ok=True)
        safe_chmod(path, 0o700)

    def _persist(self) -> None:
        self._ensure_dir()
        save_config(self._config_dir, self._config)

    def _secret_path(self, secret_ref: str) -> Path:
        return Path(self._config_dir) / f"secret_{secret_ref}.json"

    def _runtime_secrets_path(self) -> Path:
        return Path(self._config_dir) / RUNTIME_SECRETS_FILENAME


def _wallet_is_available_without_password(
    conf: WalletConfig,
    password: str | None,
) -> bool:
    return conf.type != WalletType.LOCAL_SECURE or bool(password)


def _resolve_network(explicit: str | None, provider_default: str | None) -> str:
    if explicit:
        return explicit
    if provider_default:
        return provider_default
    raise ValueError("network is required")
