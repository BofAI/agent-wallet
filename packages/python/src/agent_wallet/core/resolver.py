"""Wallet resolution helpers."""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

from agent_wallet.core.base import (
    ENV_AGENT_WALLET_DIR,
    ENV_AGENT_WALLET_PASSWORD,
    Wallet,
    WalletProvider,
)
from agent_wallet.core.config import (
    WalletsTopology,
    load_config,
    load_runtime_secrets_password,
)
from agent_wallet.core.providers.config_provider import ConfigWalletProvider
from agent_wallet.core.providers.env_provider import EnvWalletProvider
from agent_wallet.core.utils.env import clean_env_value
from agent_wallet.local.secret_loader import load_local_secret

_DEFAULT_SECRETS_DIR = os.path.join(Path.home(), ".agent-wallet")
def resolve_wallet_provider(
    *,
    network: str | None = None,
    dir: str | None = None,
) -> WalletProvider:
    """Resolve and return the provider selected from config first, then env."""
    env = os.environ
    resolved_dir = _resolve_dir(dir, env)
    password = _resolve_password(resolved_dir, env)

    if password:
        return ConfigWalletProvider(
            resolved_dir,
            password,
            network=network,
            secret_loader=load_local_secret,
        )

    config = _load_config_safe(resolved_dir)
    if _has_available_config_wallet(config):
        return ConfigWalletProvider(
            resolved_dir,
            network=network,
            secret_loader=load_local_secret,
        )

    return EnvWalletProvider(
        network=network,
        env=env,
    )

async def resolve_wallet(
    *,
    network: str | None = None,
    dir: str | None = None,
    wallet_id: str | None = None,
) -> Wallet:
    """Resolve and return the active wallet from config first, then env."""
    provider = resolve_wallet_provider(network=network, dir=dir)
    if isinstance(provider, ConfigWalletProvider):
        return (
            await provider.get_wallet(wallet_id, network)
            if wallet_id
            else await provider.get_active_wallet(network)
        )
    if isinstance(provider, EnvWalletProvider):
        return await provider.get_active_wallet(network)
    raise ValueError(f"Unsupported provider resolved: {type(provider).__name__}")



def _resolve_dir(dir: str | None, env: Mapping[str, str]) -> str:
    if dir:
        return os.path.expanduser(dir)

    env_dir = clean_env_value(env, ENV_AGENT_WALLET_DIR)
    if env_dir:
        return os.path.expanduser(env_dir)

    return _DEFAULT_SECRETS_DIR


def _resolve_password(secrets_dir: str, env: Mapping[str, str]) -> str | None:
    file_password = load_runtime_secrets_password(secrets_dir)
    if file_password:
        return file_password
    return clean_env_value(env, ENV_AGENT_WALLET_PASSWORD)


def _load_config_safe(secrets_dir: str) -> WalletsTopology | None:
    try:
        return load_config(secrets_dir)
    except FileNotFoundError:
        return None


def _has_available_config_wallet(config: WalletsTopology | None) -> bool:
    return bool(config and config.wallets)
