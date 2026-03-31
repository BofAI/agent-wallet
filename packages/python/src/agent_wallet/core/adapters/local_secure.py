"""Local signer backed by an encrypted secret file."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from agent_wallet.core.adapters.local import LocalSigner
from agent_wallet.core.config import LocalSecureWalletParams


class LocalSecureSigner(LocalSigner):
    """Local signer backed by an encrypted secret file."""

    def __init__(
        self,
        params: LocalSecureWalletParams,
        config_dir: str | Path,
        password: str | None,
        network: str | None,
        secret_loader: Callable[[str | Path, str, str], bytes] | None,
    ) -> None:
        if not password:
            raise ValueError("Password required for local_secure wallets")
        if secret_loader is None:
            raise ValueError("local_secure wallets require a configured secret loader")
        private_key = secret_loader(config_dir, password, params.secret_ref)
        super().__init__(private_key=private_key, network=network)
