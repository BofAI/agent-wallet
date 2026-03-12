"""Environment-driven provider factory."""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

from agent_wallet.core.base import BaseWallet
from agent_wallet.core.providers.base import WalletProvider
from agent_wallet.core.providers.local import LocalWalletProvider
from agent_wallet.core.providers.static import StaticWalletProvider

_DEFAULT_SECRETS_DIR = os.path.join(Path.home(), ".agent-wallet")
_ENV_AGENT_WALLET_PASSWORD = "AGENT_WALLET_PASSWORD"
_ENV_AGENT_WALLET_DIR = "AGENT_WALLET_DIR"
_ENV_AGENT_WALLET_PRIVATE_KEY = "AGENT_WALLET_PRIVATE_KEY"
_ENV_AGENT_WALLET_MNEMONIC = "AGENT_WALLET_MNEMONIC"
_ENV_AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX = "AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX"

_NetworkFamily = str


def resolve_wallet_provider(
    *,
    network: str | None = None,
) -> WalletProvider:
    """Resolve the appropriate provider from environment variables."""
    return _resolve_wallet_provider_from_env(os.environ, network=network)


def _resolve_wallet_provider_from_env(
    env: Mapping[str, str],
    *,
    network: str | None = None,
) -> WalletProvider:
    password = _clean_env_value(env, _ENV_AGENT_WALLET_PASSWORD)
    if password:
        secrets_dir = _clean_env_value(env, _ENV_AGENT_WALLET_DIR)
        resolved_dir = (
            os.path.expanduser(secrets_dir) if secrets_dir else _DEFAULT_SECRETS_DIR
        )
        return LocalWalletProvider(resolved_dir, password)

    return StaticWalletProvider(_create_wallet_from_env(env, network))


def _create_wallet_from_env(env: Mapping[str, str], network: str | None) -> BaseWallet:
    private_key = _clean_env_value(env, _ENV_AGENT_WALLET_PRIVATE_KEY)
    mnemonic = _clean_env_value(env, _ENV_AGENT_WALLET_MNEMONIC)
    account_index = _parse_account_index(
        env.get(_ENV_AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX)
    )

    _assert_single_wallet_source(
        private_key=private_key,
        mnemonic=mnemonic,
    )

    if not private_key and not mnemonic:
        raise ValueError(
            "resolve_wallet_provider requires one of: AGENT_WALLET_PASSWORD, "
            "AGENT_WALLET_PRIVATE_KEY, or AGENT_WALLET_MNEMONIC"
        )

    family = _parse_network_family(network)

    if private_key:
        if family == "tron":
            return _create_tron_wallet_from_private_key(private_key)
        return _create_evm_wallet_from_private_key(private_key)

    assert mnemonic is not None
    if family == "tron":
        return _create_tron_wallet_from_mnemonic(mnemonic, account_index)
    return _create_evm_wallet_from_mnemonic(mnemonic, account_index)


def _clean_env_value(env: Mapping[str, str], key: str) -> str | None:
    value = env.get(key)
    if value is None:
        return None
    value = value.strip()
    return value or None


def _assert_single_wallet_source(
    *,
    private_key: str | None,
    mnemonic: str | None,
) -> None:
    if private_key and mnemonic:
        raise ValueError(
            "Provide only one of AGENT_WALLET_PRIVATE_KEY or "
            "AGENT_WALLET_MNEMONIC"
        )


def _parse_network_family(network: str | None) -> _NetworkFamily:
    normalized = network.strip().lower() if network else None
    if not normalized:
        raise ValueError(
            "resolve_wallet_provider requires network when using "
            "AGENT_WALLET_PRIVATE_KEY or AGENT_WALLET_MNEMONIC"
        )
    if normalized == "tron" or normalized.startswith("tron:"):
        return "tron"
    if normalized == "eip155" or normalized.startswith("eip155:"):
        return "eip155"
    raise ValueError("network must start with 'tron' or 'eip155'")


def _parse_account_index(value: str | None) -> int:
    if value is None:
        return 0
    normalized = value.strip()
    if not normalized:
        return 0
    if not normalized.isdigit():
        raise ValueError(
            "AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX must be a non-negative integer"
        )
    return int(normalized)


def _create_evm_wallet_from_private_key(private_key: str) -> BaseWallet:
    from agent_wallet.core.adapters.evm import EvmWallet

    return EvmWallet(private_key=_decode_private_key(private_key))


def _create_evm_wallet_from_mnemonic(mnemonic: str, account_index: int) -> BaseWallet:
    from eth_account import Account

    Account.enable_unaudited_hdwallet_features()
    account = Account.from_mnemonic(
        mnemonic, account_path=f"m/44'/60'/0'/0/{account_index}"
    )
    return _create_evm_wallet_from_private_key(account.key.hex())


def _create_tron_wallet_from_private_key(private_key: str) -> BaseWallet:
    from agent_wallet.core.adapters.tron import TronWallet

    return TronWallet(private_key=_decode_private_key(private_key))


def _create_tron_wallet_from_mnemonic(mnemonic: str, account_index: int) -> BaseWallet:
    from eth_account import Account

    Account.enable_unaudited_hdwallet_features()
    account = Account.from_mnemonic(
        mnemonic, account_path=f"m/44'/195'/0'/0/{account_index}"
    )
    return _create_tron_wallet_from_private_key(account.key.hex())


def _decode_private_key(private_key: str) -> bytes:
    normalized = private_key.strip().removeprefix("0x")
    if len(normalized) != 64:
        raise ValueError("Private key must be 32 bytes (64 hex characters)")
    try:
        return bytes.fromhex(normalized)
    except ValueError as exc:
        raise ValueError("Private key must be a valid hex string") from exc
