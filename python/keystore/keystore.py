"""Keystore: fixed-path protobuf file for account info."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from keystore.base import KeystoreBase, KeystoreData
from keystore.keystore_proto import decode_keystore_data, encode_keystore_data

DEFAULT_KEYSTORE_FILENAME = "Keystore"


def _default_path() -> str:
    return str(Path.home() / ".agent_wallet" / DEFAULT_KEYSTORE_FILENAME)


class Keystore(KeystoreBase):
    """File-based keystore (protobuf bytes)."""

    def __init__(
        self,
        file_path: Optional[str] = None,
    ):
        self.file_path = file_path or os.environ.get("KEYSTORE_PATH") or _default_path()
        self._data: KeystoreData = {}
        self._loaded = False

    def get_path(self) -> str:
        return self.file_path

    def read(self) -> KeystoreData:
        if not os.path.isfile(self.file_path):
            self._data = {}
            self._loaded = True
            return self._data

        with open(self.file_path, "rb") as f:
            raw = f.read()

        # Try legacy JSON first (old plaintext format)
        parsed: object
        parsed_as_json = False
        try:
            txt = raw.decode("utf-8")
            parsed = json.loads(txt)
            parsed_as_json = True
        except Exception:
            parsed = None
            parsed_as_json = False

        if parsed_as_json and isinstance(parsed, dict):
            # Legacy unencrypted JSON format
            self._data = parsed
        else:
            # New protobuf binary format
            self._data = decode_keystore_data(raw)

        self._loaded = True
        return self._data.copy()

    def _ensure_loaded(self) -> None:
        if not self._loaded:
            self.read()

    def get(self, key: str) -> Optional[str]:
        self._ensure_loaded()
        return self._data.get(key)

    def set(self, key: str, value: str) -> None:
        """Set a value by key. Loads existing data first if not yet loaded."""
        self._ensure_loaded()
        self._data[key] = value

    def keys(self) -> list[str]:
        self._ensure_loaded()
        return list(self._data.keys())

    def get_all(self) -> KeystoreData:
        self._ensure_loaded()
        return self._data.copy()

    def write(self) -> None:
        """Write current data to file. Atomic via tmp+rename."""
        Path(self.file_path).parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.file_path + ".tmp"

        proto_bytes = encode_keystore_data(self._data)
        with open(tmp_path, "wb") as f:
            f.write(proto_bytes)

        os.replace(tmp_path, self.file_path)

    @staticmethod
    def from_file(file_path: str) -> KeystoreData:
        ks = Keystore(file_path=file_path)
        return ks.read()

    @staticmethod
    def to_file(
        file_path: str,
        data: KeystoreData,
    ) -> None:
        ks = Keystore(file_path=file_path)
        ks._data = dict(data)
        ks._loaded = True
        ks.write()

