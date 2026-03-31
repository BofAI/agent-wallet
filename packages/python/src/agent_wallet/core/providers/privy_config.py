"""Privy configuration resolution and validation."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from agent_wallet.core.errors import PrivyConfigError


@dataclass(frozen=True)
class PrivyConfig:
    app_id: str
    app_secret: str
    wallet_id: str


class PrivyConfigResolver:
    def __init__(
        self,
        *,
        source: Mapping[str, str] | None = None,
    ) -> None:
        self._source = source or {}

    def is_enabled(self) -> bool:
        merged = self._merge()
        if not merged.get("app_id") or not merged.get("app_secret") or not merged.get("wallet_id"):
            return False
        return True

    def resolve(self) -> PrivyConfig:
        merged = self._merge()
        missing = _missing_required(merged)
        if missing:
            raise PrivyConfigError(
                f"Missing required Privy config keys: {', '.join(missing)}"
            )

        return PrivyConfig(
            app_id=merged["app_id"],
            app_secret=merged["app_secret"],
            wallet_id=merged["wallet_id"],
        )

    def _merge(self) -> dict[str, str | None]:
        source = _normalize(self._source)
        return {
            "app_id": source.get("app_id"),
            "app_secret": source.get("app_secret"),
            "wallet_id": source.get("wallet_id"),
        }


def _normalize(values: Mapping[str, str]) -> dict[str, str | None]:
    return {
        key: _normalize_value(values.get(key))
        for key in [
            "app_id",
            "app_secret",
            "wallet_id",
        ]
    }


def _normalize_value(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _missing_required(values: Mapping[str, str | None]) -> list[str]:
    missing: list[str] = []
    if not values.get("app_id"):
        missing.append("app_id")
    if not values.get("app_secret"):
        missing.append("app_secret")
    if not values.get("wallet_id"):
        missing.append("wallet_id")
    return missing
