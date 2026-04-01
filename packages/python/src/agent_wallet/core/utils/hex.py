"""Hex string helpers."""

from __future__ import annotations


def strip_hex_prefix(value: str) -> str:
    return value[2:] if value.startswith("0x") else value
