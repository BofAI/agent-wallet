"""Local secure secret loading helpers."""

from __future__ import annotations

from pathlib import Path

from agent_wallet.local.kv_store import SecureKVStore


def load_local_secret(
    config_dir: str | Path,
    password: str,
    secret_ref: str,
) -> bytes:
    """Load a local_secure secret from the encrypted local store."""
    kv_store = SecureKVStore(str(config_dir), password)
    kv_store.verify_password()
    return kv_store.load_secret(secret_ref)
