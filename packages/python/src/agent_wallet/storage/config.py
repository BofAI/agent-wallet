"""Storage layer: wallets_config.json loading and validation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from pydantic import BaseModel

from agent_wallet.core.base import WalletType


class WalletConfig(BaseModel):
    """Single wallet entry in wallets_config.json."""

    type: WalletType
    address: Optional[str] = None
    identity_file: Optional[str] = None
    cred_file: Optional[str] = None
    chain_id: Optional[str] = None
    # WaaS-specific
    wallet_id: Optional[str] = None
    # Remote-specific
    remote_url: Optional[str] = None


class WalletsTopology(BaseModel):
    """Root model for wallets_config.json."""

    wallets: dict[str, WalletConfig]


class WalletInfo(BaseModel):
    """Public wallet summary (no secrets)."""

    id: str
    type: str
    chain_id: Optional[str] = None


def load_config(secrets_dir: str | Path) -> WalletsTopology:
    """Load and validate wallets_config.json from a secrets directory."""
    path = Path(secrets_dir) / "wallets_config.json"
    if not path.exists():
        raise FileNotFoundError(f"Config not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    return WalletsTopology.model_validate(data)


def save_config(secrets_dir: str | Path, config: WalletsTopology) -> None:
    """Write wallets_config.json to disk."""
    path = Path(secrets_dir) / "wallets_config.json"
    path.write_text(
        json.dumps(config.model_dump(exclude_none=True), indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
