"""Key derivation helpers."""

from __future__ import annotations

from agent_wallet.core.base import Network


def decode_private_key(private_key: str) -> bytes:
    normalized = private_key.strip().removeprefix("0x")
    if len(normalized) != 64:
        raise ValueError("Private key must be 32 bytes (64 hex characters)")
    try:
        return bytes.fromhex(normalized)
    except ValueError as exc:
        raise ValueError("Private key must be a valid hex string") from exc


def derive_key_from_mnemonic(network: Network, mnemonic: str, account_index: int) -> bytes:
    from eth_account import Account

    Account.enable_unaudited_hdwallet_features()
    path = (
        f"m/44'/195'/0'/0/{account_index}"
        if network == Network.TRON
        else f"m/44'/60'/0'/0/{account_index}"
    )
    account = Account.from_mnemonic(mnemonic, account_path=path)
    return bytes(account.key)
