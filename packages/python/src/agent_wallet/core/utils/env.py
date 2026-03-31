"""Shared env parsing helpers."""

from __future__ import annotations

from collections.abc import Mapping


def clean_env_value(env: Mapping[str, str], key: str) -> str | None:
    value = env.get(key)
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def first_env(env: Mapping[str, str], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = clean_env_value(env, key)
        if value:
            return value
    return None


def parse_account_index(value: str | None) -> int:
    if not value:
        return 0
    if not value.isdigit():
        raise ValueError("AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX must be a non-negative integer")
    return int(value)
