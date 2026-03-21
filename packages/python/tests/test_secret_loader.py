"""Tests for local secret_loader helper."""

from __future__ import annotations

import tempfile

import pytest

from agent_wallet.local.kv_store import SecureKVStore
from agent_wallet.local.secret_loader import load_local_secret

TEST_PASSWORD = "Loader-test-pw-1!"
TEST_KEY = bytes.fromhex(
    "4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b"
)


def test_load_local_secret_roundtrip():
    with tempfile.TemporaryDirectory() as tmpdir:
        kv = SecureKVStore(tmpdir, TEST_PASSWORD)
        kv.init_master()
        kv.save_secret("my_ref", TEST_KEY)

        loaded = load_local_secret(tmpdir, TEST_PASSWORD, "my_ref")
        assert loaded == TEST_KEY


def test_load_local_secret_wrong_password():
    with tempfile.TemporaryDirectory() as tmpdir:
        kv = SecureKVStore(tmpdir, TEST_PASSWORD)
        kv.init_master()
        kv.save_secret("my_ref", TEST_KEY)

        from agent_wallet.core.errors import DecryptionError

        with pytest.raises(DecryptionError):
            load_local_secret(tmpdir, "wrong-password", "my_ref")
