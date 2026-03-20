"""Storage layer: wallets_config.json loading and validation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, Discriminator

from agent_wallet.core.constants import (
    RUNTIME_SECRETS_FILENAME,
    WALLETS_CONFIG_FILENAME,
)


class LocalSecureWalletConfig(BaseModel):
    """Encrypted local keystore wallet."""

    type: Literal["local_secure"]
    secret_ref: str


class RawSecretPrivateKeyConfig(BaseModel):
    """Raw private key secret stored directly in config."""

    source: Literal["private_key"]
    private_key: str


class RawSecretMnemonicConfig(BaseModel):
    """Raw mnemonic secret stored directly in config."""

    source: Literal["mnemonic"]
    mnemonic: str
    account_index: int = 0


RawSecretMaterial = Annotated[
    RawSecretPrivateKeyConfig | RawSecretMnemonicConfig,
    Discriminator("source"),
]


class RawSecretWalletConfig(BaseModel):
    """Raw secret wallet stored directly in wallets_config.json."""

    type: Literal["raw_secret"]
    material: RawSecretMaterial


WalletConfig = Annotated[
    LocalSecureWalletConfig | RawSecretWalletConfig,
    Discriminator("type"),
]


class WalletsTopology(BaseModel):
    """Root model for wallets_config.json."""

    active_wallet: str | None = None
    wallets: dict[str, WalletConfig]  # type: ignore[valid-type]


def load_config(secrets_dir: str | Path) -> WalletsTopology:
    """Load and validate wallets_config.json."""
    path = Path(secrets_dir) / WALLETS_CONFIG_FILENAME
    if not path.exists():
        raise FileNotFoundError(f"Config not found: {path}")

    data = json.loads(path.read_text(encoding="utf-8"))
    return WalletsTopology.model_validate(data)


def save_config(secrets_dir: str | Path, config: WalletsTopology) -> None:
    """Write wallets_config.json to disk."""
    path = Path(secrets_dir) / WALLETS_CONFIG_FILENAME
    _write_config(path, config)


def load_runtime_secrets_password(secrets_dir: str | Path) -> str | None:
    """Load password from runtime_secrets.json if present."""
    path = Path(secrets_dir) / RUNTIME_SECRETS_FILENAME
    if not path.exists():
        return None

    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{RUNTIME_SECRETS_FILENAME} must contain a JSON object")

    password = data.get("password")
    if password is None:
        return None
    if not isinstance(password, str):
        raise ValueError(f"{RUNTIME_SECRETS_FILENAME}.password must be a string")

    normalized = password.strip()
    return normalized or None


def _write_config(path: Path, config: WalletsTopology) -> None:
    """Internal helper to serialize and write config."""
    path.write_text(
        json.dumps(config.model_dump(exclude_none=True), indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
