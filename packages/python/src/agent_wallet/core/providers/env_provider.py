"""Provider for env-sourced wallet material."""

from __future__ import annotations

import os
from collections.abc import Mapping

from agent_wallet.core.base import (
    ENV_ACCOUNT_INDEX_KEYS,
    ENV_MNEMONIC_KEYS,
    ENV_PRIVATE_KEY_KEYS,
    Wallet,
    WalletProvider,
)
from agent_wallet.core.config import RawSecretMnemonicParams, RawSecretPrivateKeyParams
from agent_wallet.core.providers.wallet_builder import create_env_adapter
from agent_wallet.core.utils.env import first_env, parse_account_index
from agent_wallet.core.utils.network import resolve_network


class EnvWalletProvider(WalletProvider):
    """Create a wallet from env vars."""

    def __init__(
        self,
        *,
        network: str | None = None,
        env: Mapping[str, str] | None = None,
    ) -> None:
        self._network = network
        self._env = env or os.environ

    async def get_wallet(self, network: str | None = None) -> Wallet:
        return await self.get_active_wallet(network)

    async def get_active_wallet(self, network: str | None = None) -> Wallet:
        wallet = _resolve_env_wallet(self._env, network, self._network)
        if not wallet:
            raise ValueError(
                "resolve_wallet could not find a wallet source in config or env"
            )
        return create_env_adapter(wallet)


def _resolve_env_wallet(
    env: Mapping[str, str],
    explicit_network: str | None,
    provider_default: str | None,
) -> tuple[RawSecretPrivateKeyParams | RawSecretMnemonicParams, str | None] | None:
    raw = _parse_raw_secret_env(env)
    if raw:
        return (raw, resolve_network(explicit_network, provider_default))
    return None


def _parse_raw_secret_env(
    env: Mapping[str, str],
) -> RawSecretPrivateKeyParams | RawSecretMnemonicParams | None:
    private_key = first_env(env, ENV_PRIVATE_KEY_KEYS)
    mnemonic = first_env(env, ENV_MNEMONIC_KEYS)
    if private_key and mnemonic:
        raise ValueError(
            "Provide only one of AGENT_WALLET_PRIVATE_KEY or "
            "AGENT_WALLET_MNEMONIC"
        )
    if private_key:
        return RawSecretPrivateKeyParams(source="private_key", private_key=private_key)
    if mnemonic:
        account_index = parse_account_index(first_env(env, ENV_ACCOUNT_INDEX_KEYS))
        return RawSecretMnemonicParams(
            source="mnemonic", mnemonic=mnemonic, account_index=account_index
        )
    return None
