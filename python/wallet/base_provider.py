"""Abstract base provider: compatible get_account_info/sign_tx/sign_message."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Optional

from keystore.base import KeystoreBase
from keystore.keystore import Keystore
from wallet.types import AccountInfo, SignedTxResult


class BaseProvider(ABC):
    def __init__(
        self,
        keystore_path: Optional[str] = None,
        keystore: Optional[KeystoreBase] = None,
    ):
        self.keystore: KeystoreBase = keystore or Keystore(file_path=keystore_path)
        # Keystore initialization (file creation) is handled by CLI.
        # Providers only read existing keystore data.
        self.keystore.read()

    async def init(self) -> "BaseProvider":
        """Compatibility no-op (keystore is read in constructor)."""
        return self

    @abstractmethod
    async def get_account_info(self) -> AccountInfo:
        ...

    @abstractmethod
    async def sign_tx(self, unsigned_tx: Any) -> SignedTxResult:
        ...

    @abstractmethod
    async def sign_message(self, message: bytes) -> str:
        ...

