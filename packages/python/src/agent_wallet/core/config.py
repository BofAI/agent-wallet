"""Storage layer: wallets_config.json loading and validation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, model_validator

from agent_wallet.core.base import WalletType
from agent_wallet.core.constants import (
    RUNTIME_SECRETS_FILENAME,
    WALLETS_CONFIG_FILENAME,
)


class LocalSecureWalletParams(BaseModel):
    """Encrypted local keystore wallet params."""

    secret_ref: str


class RawSecretPrivateKeyParams(BaseModel):
    """Raw private key secret stored directly in config."""

    source: Literal["private_key"]
    private_key: str


class RawSecretMnemonicParams(BaseModel):
    """Raw mnemonic secret stored directly in config."""

    source: Literal["mnemonic"]
    mnemonic: str
    account_index: int = 0


RawSecretParams = RawSecretPrivateKeyParams | RawSecretMnemonicParams


class WalletConfig(BaseModel):
    """Single wallet entry in wallets_config.json."""

    type: WalletType
    params: LocalSecureWalletParams | RawSecretParams

    @model_validator(mode="after")
    def _validate_params(self) -> WalletConfig:
        if self.type == WalletType.LOCAL_SECURE:
            if not isinstance(self.params, LocalSecureWalletParams):
                raise ValueError("local_secure wallets require LocalSecureWalletParams")
            return self

        if self.type == WalletType.RAW_SECRET:
            if isinstance(self.params, (RawSecretPrivateKeyParams, RawSecretMnemonicParams)):
                return self
            raise ValueError("raw_secret wallets require raw secret params")

        raise ValueError(f"Unknown wallet config type: {self.type}")

    @property
    def secret_ref(self) -> str:
        if self.type != WalletType.LOCAL_SECURE:
            raise AttributeError("secret_ref is only available for local_secure wallets")
        return self.params.secret_ref


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
