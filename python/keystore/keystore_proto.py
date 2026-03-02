"""KeystoreData protobuf codec (generated from `keystore.proto`).

Replaces the previous hand-rolled wire-format implementation with the official
`google.protobuf` runtime + generated `keystore_pb2.py` code.
"""

from __future__ import annotations

from typing import Dict

# NOTE: This module requires the `protobuf` package at runtime.
from google.protobuf.message import DecodeError  # type: ignore[import-not-found]

from keystore.keystore_pb2 import KeystoreData


def encode_keystore_data(data: Dict[str, str]) -> bytes:
    """Encode dict[str, str] as KeystoreData protobuf bytes."""
    msg = KeystoreData()
    if data:
        msg.entries.update(data)
    return msg.SerializeToString()


def decode_keystore_data(buf: bytes) -> Dict[str, str]:
    """Decode KeystoreData protobuf bytes into dict[str, str]."""
    msg = KeystoreData()
    try:
        msg.ParseFromString(buf)
    except DecodeError as e:
        # Keep the historical error type for callers/tests.
        raise ValueError(str(e)) from e
    return dict(msg.entries)
