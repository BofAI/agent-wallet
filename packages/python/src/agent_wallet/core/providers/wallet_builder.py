"""Shared wallet construction helpers for providers."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from agent_wallet.core.base import Network, Wallet, WalletType
from agent_wallet.core.config import WalletConfig


def parse_network_family(network: str | None) -> Network:
    normalized = network.strip().lower() if network else None
    if not normalized:
        raise ValueError("network is required")
    if normalized == "tron" or normalized.startswith("tron:"):
        return Network.TRON
    if normalized == "eip155" or normalized.startswith("eip155:"):
        return Network.EVM
    raise ValueError("network must start with 'tron' or 'eip155'")


def create_adapter(
    conf: WalletConfig,
    config_dir: str | Path,
    password: str | None,
    network: str,
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
    raise ValueError(f"Unknown wallet config type: {conf.type}")


def decode_private_key(private_key: str) -> bytes:
    normalized = private_key.strip().removeprefix("0x")
    if len(normalized) != 64:
        raise ValueError("Private key must be 32 bytes (64 hex characters)")
    try:
        return bytes.fromhex(normalized)
    except ValueError as exc:
        raise ValueError("Private key must be a valid hex string") from exc


def derive_key_from_mnemonic(
    network: Network, mnemonic: str, account_index: int
) -> bytes:
    from eth_account import Account

    Account.enable_unaudited_hdwallet_features()
    path = (
        f"m/44'/195'/0'/0/{account_index}"
        if network == Network.TRON
        else f"m/44'/60'/0'/0/{account_index}"
    )
    account = Account.from_mnemonic(mnemonic, account_path=path)
    return bytes(account.key)
