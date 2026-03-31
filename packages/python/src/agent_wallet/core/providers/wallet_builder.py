"""Shared wallet construction helpers for providers."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from agent_wallet.core.base import Wallet, WalletType
from agent_wallet.core.config import (
    RawSecretMnemonicParams,
    RawSecretPrivateKeyParams,
    WalletConfig,
)
from agent_wallet.core.providers.privy_config import PrivyConfigResolver


def create_adapter(
    conf: WalletConfig,
    config_dir: str | Path,
    password: str | None,
    network: str | None,
    secret_loader: Callable[[str | Path, str, str], bytes] | None,
) -> Wallet:
    if conf.type == WalletType.LOCAL_SECURE:
        from agent_wallet.core.adapters.local_secure import LocalSecureSigner

        return LocalSecureSigner(
            params=conf.params,
            config_dir=config_dir,
            password=password,
            network=network,
            secret_loader=secret_loader,
        )
    if conf.type == WalletType.RAW_SECRET:
        from agent_wallet.core.adapters.raw_secret import RawSecretSigner

        return RawSecretSigner(params=conf.params, network=network)
    if conf.type == WalletType.PRIVY:
        from agent_wallet.core.adapters.privy import PrivyAdapter

        resolver = PrivyConfigResolver(source=conf.params.model_dump())
        resolved = resolver.resolve()
        return PrivyAdapter(
            app_id=resolved.app_id,
            app_secret=resolved.app_secret,
            wallet_id=resolved.wallet_id,
        )
    raise ValueError(f"Unknown wallet config type: {conf.type}")


EnvWalletResolved = tuple[
    RawSecretPrivateKeyParams | RawSecretMnemonicParams,
    str | None,
]


def create_env_adapter(resolved: EnvWalletResolved) -> Wallet:
    params, network = resolved
    from agent_wallet.core.adapters.raw_secret import RawSecretSigner

    return RawSecretSigner(params=params, network=network)
