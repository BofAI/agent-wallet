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
_ENV_TRON_PRIVATE_KEY = "TRON_PRIVATE_KEY"
_ENV_TRON_MNEMONIC = "TRON_MNEMONIC"
_ENV_EVM_PRIVATE_KEY = "EVM_PRIVATE_KEY"
_ENV_EVM_MNEMONIC = "EVM_MNEMONIC"


def WalletFactory() -> WalletProvider:
    """Create the appropriate provider from environment variables."""
    env = os.environ
    password = _clean_env_value(env, _ENV_AGENT_WALLET_PASSWORD)
    if password:
        secrets_dir = _clean_env_value(env, _ENV_AGENT_WALLET_DIR)
        resolved_dir = (
            os.path.expanduser(secrets_dir) if secrets_dir else _DEFAULT_SECRETS_DIR
        )
        return LocalWalletProvider(resolved_dir, password)

    return StaticWalletProvider(_create_wallet_from_env(env))


def _create_wallet_from_env(env: Mapping[str, str]) -> BaseWallet:
    tron_private_key = _clean_env_value(env, _ENV_TRON_PRIVATE_KEY)
    tron_mnemonic = _clean_env_value(env, _ENV_TRON_MNEMONIC)
    evm_private_key = _clean_env_value(env, _ENV_EVM_PRIVATE_KEY)
    evm_mnemonic = _clean_env_value(env, _ENV_EVM_MNEMONIC)

    _assert_single_wallet_source(
        tron_private_key=tron_private_key,
        tron_mnemonic=tron_mnemonic,
        evm_private_key=evm_private_key,
        evm_mnemonic=evm_mnemonic,
    )

    if tron_private_key:
        return _create_tron_wallet_from_private_key(tron_private_key)
    if tron_mnemonic:
        return _create_tron_wallet_from_mnemonic(tron_mnemonic)
    if evm_private_key:
        return _create_evm_wallet_from_private_key(evm_private_key)
    if evm_mnemonic:
        return _create_evm_wallet_from_mnemonic(evm_mnemonic)

    raise ValueError(
        "WalletFactory requires one of: AGENT_WALLET_PASSWORD, "
        "TRON_PRIVATE_KEY, TRON_MNEMONIC, EVM_PRIVATE_KEY, or EVM_MNEMONIC"
    )


def _clean_env_value(env: Mapping[str, str], key: str) -> str | None:
    value = env.get(key)
    if value is None:
        return None
    value = value.strip()
    return value or None


def _assert_single_wallet_source(
    *,
    tron_private_key: str | None,
    tron_mnemonic: str | None,
    evm_private_key: str | None,
    evm_mnemonic: str | None,
) -> None:
    if tron_private_key and tron_mnemonic:
        raise ValueError("Provide only one of TRON_PRIVATE_KEY or TRON_MNEMONIC")
    if evm_private_key and evm_mnemonic:
        raise ValueError("Provide only one of EVM_PRIVATE_KEY or EVM_MNEMONIC")

    has_tron = tron_private_key is not None or tron_mnemonic is not None
    has_evm = evm_private_key is not None or evm_mnemonic is not None
    if has_tron and has_evm:
        raise ValueError(
            "Provide either TRON_* or EVM_* environment variables, not both"
        )


def _create_evm_wallet_from_private_key(private_key: str) -> BaseWallet:
    from agent_wallet.core.adapters.evm import EvmWallet

    return EvmWallet(private_key=_decode_private_key(private_key))


def _create_evm_wallet_from_mnemonic(mnemonic: str) -> BaseWallet:
    from eth_account import Account

    Account.enable_unaudited_hdwallet_features()
    account = Account.from_mnemonic(mnemonic)
    return _create_evm_wallet_from_private_key(account.key.hex())


def _create_tron_wallet_from_private_key(private_key: str) -> BaseWallet:
    from agent_wallet.core.adapters.tron import TronWallet

    return TronWallet(private_key=_decode_private_key(private_key))


def _create_tron_wallet_from_mnemonic(mnemonic: str) -> BaseWallet:
    from eth_account import Account

    Account.enable_unaudited_hdwallet_features()
    account = Account.from_mnemonic(mnemonic, account_path="m/44'/195'/0'/0/0")
    return _create_tron_wallet_from_private_key(account.key.hex())


def _decode_private_key(private_key: str) -> bytes:
    normalized = private_key.strip().removeprefix("0x")
    if len(normalized) != 64:
        raise ValueError("Private key must be 32 bytes (64 hex characters)")
    try:
        return bytes.fromhex(normalized)
    except ValueError as exc:
        raise ValueError("Private key must be a valid hex string") from exc
