"""Storage layer: wallets_config.json loading, validation, and migration."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Callable, Optional

from pydantic import BaseModel

from agent_wallet.core.base import WalletType

logger = logging.getLogger(__name__)

# Current config schema version.  Bump this when the schema changes and
# add a corresponding migration function in MIGRATIONS.
CURRENT_CONFIG_VERSION = 1


class WalletConfig(BaseModel):
    """Single wallet entry in wallets_config.json."""

    type: WalletType
    address: Optional[str] = None
    identity_file: Optional[str] = None
    cred_file: Optional[str] = None
    # WaaS-specific
    wallet_id: Optional[str] = None
    # Remote-specific
    remote_url: Optional[str] = None


class WalletsTopology(BaseModel):
    """Root model for wallets_config.json."""

    config_version: int = CURRENT_CONFIG_VERSION
    wallets: dict[str, WalletConfig]


class WalletInfo(BaseModel):
    """Public wallet summary (no secrets)."""

    id: str
    type: str


# ---------------------------------------------------------------------------
# Migration functions
# ---------------------------------------------------------------------------
# Each function takes the raw dict (as loaded from JSON) and returns the
# mutated dict at the next version.  Migrations are applied sequentially.


def _migrate_v0_to_v1(data: dict) -> dict:
    """v0 (no config_version field) → v1.

    - Adds ``config_version: 1``.
    - No schema changes — existing fields are unchanged.
    """
    data["config_version"] = 1
    return data


# Ordered list of migrations.  Index ``i`` migrates from version ``i`` to
# ``i + 1``.  When you add a new version, append the function here AND bump
# ``CURRENT_CONFIG_VERSION``.
MIGRATIONS: list[Callable[[dict], dict]] = [
    _migrate_v0_to_v1,
]


def migrate_config(data: dict) -> dict:
    """Apply all pending migrations to *data* (in-place) and return it.

    The function is idempotent: calling it on an already-current config is a
    no-op.
    """
    version = data.get("config_version", 0)

    if version > CURRENT_CONFIG_VERSION:
        raise ValueError(
            f"Config version {version} is newer than supported "
            f"({CURRENT_CONFIG_VERSION}). Please upgrade agent-wallet."
        )

    if version < CURRENT_CONFIG_VERSION:
        logger.info(
            "Migrating config from v%d → v%d", version, CURRENT_CONFIG_VERSION
        )

    while version < CURRENT_CONFIG_VERSION:
        data = MIGRATIONS[version](data)
        version = data.get("config_version", version + 1)

    return data


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def load_config(secrets_dir: str | Path) -> WalletsTopology:
    """Load, migrate, validate, and return wallets_config.json."""
    path = Path(secrets_dir) / "wallets_config.json"
    if not path.exists():
        raise FileNotFoundError(f"Config not found: {path}")

    data = json.loads(path.read_text(encoding="utf-8"))
    old_version = data.get("config_version", 0)

    data = migrate_config(data)

    topology = WalletsTopology.model_validate(data)

    # Persist the migrated config so future loads are instant.
    if old_version < CURRENT_CONFIG_VERSION:
        _write_config(path, topology)
        logger.info("Migrated config written to %s", path)

    return topology


def save_config(secrets_dir: str | Path, config: WalletsTopology) -> None:
    """Write wallets_config.json to disk (always at current version)."""
    config.config_version = CURRENT_CONFIG_VERSION
    path = Path(secrets_dir) / "wallets_config.json"
    _write_config(path, config)


def _write_config(path: Path, config: WalletsTopology) -> None:
    """Internal helper to serialize and write config."""
    path.write_text(
        json.dumps(config.model_dump(exclude_none=True), indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
