"""Keystore base class (abstract).

Providers should depend on this type, so you can inject alternative keystore
implementations (memory/db/etc.) without changing provider logic.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

KeystoreData = dict[str, str]


class KeystoreBase(ABC):
    @abstractmethod
    def get_path(self) -> str:
        """Get the path/identifier of the keystore (if applicable)."""
        ...

    @abstractmethod
    def read(self) -> KeystoreData:
        """Read data from the underlying store."""
        ...

    @abstractmethod
    def get(self, key: str) -> Optional[str]:
        """Get a value by key."""
        ...

    @abstractmethod
    def set(self, key: str, value: str) -> None:
        """Set a value by key (does not persist until write())."""
        ...

    @abstractmethod
    def keys(self) -> list[str]:
        """List keys."""
        ...

    @abstractmethod
    def get_all(self) -> KeystoreData:
        """Get full data snapshot."""
        ...

    @abstractmethod
    def write(self) -> None:
        """Persist current data to the underlying store."""
        ...

