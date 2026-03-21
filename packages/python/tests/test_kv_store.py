"""Tests for SecureKVStore secret roundtrip and compatibility."""

from __future__ import annotations

import json
import os
import tempfile

import pytest

from agent_wallet.core.errors import DecryptionError
from agent_wallet.local.kv_store import SecureKVStore


@pytest.fixture
def secrets_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def kv_store(secrets_dir):
    store = SecureKVStore(secrets_dir, password="test-password-123")
    store.init_master()
    return store


class TestMasterPassword:
    def test_init_and_verify(self, kv_store):
        assert kv_store.verify_password() is True

    def test_wrong_password(self, secrets_dir):
        store1 = SecureKVStore(secrets_dir, "correct-password")
        store1.init_master()

        store2 = SecureKVStore(secrets_dir, "wrong-password")
        with pytest.raises(DecryptionError):
            store2.verify_password()

    def test_missing_master_json(self, secrets_dir):
        store = SecureKVStore(secrets_dir, "any-password")
        with pytest.raises(FileNotFoundError, match=r"master\.json"):
            store.verify_password()


class TestSecrets:
    def test_save_and_load_roundtrip(self, kv_store):
        secret = os.urandom(32)
        kv_store.save_secret("test_wallet", secret)
        loaded = kv_store.load_secret("test_wallet")
        assert loaded == secret

    def test_generate_secret(self, kv_store):
        secret = kv_store.generate_secret("gen_wallet")
        assert len(secret) == 32
        assert kv_store.load_secret("gen_wallet") == secret

    def test_generate_secret_custom_length(self, kv_store):
        secret = kv_store.generate_secret("custom", length=48)
        assert len(secret) == 48
        assert kv_store.load_secret("custom") == secret

    def test_load_nonexistent(self, kv_store):
        with pytest.raises(FileNotFoundError):
            kv_store.load_secret("nonexistent")


class TestEthAccountCompat:
    def test_decrypt_eth_account_encrypted_key(self, kv_store, secrets_dir):
        from eth_account import Account

        key = os.urandom(32)
        password = "test-password-123"
        keystore = Account.encrypt(key, password)

        path = os.path.join(secrets_dir, "secret_eth_compat.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(dict(keystore), f)

        loaded = kv_store.load_secret("eth_compat")
        assert loaded == key

    def test_eth_account_decrypts_our_encrypted_key(self, kv_store, secrets_dir):
        from eth_account import Account

        key = os.urandom(32)
        password = "test-password-123"
        kv_store.save_secret("our_compat", key)

        path = os.path.join(secrets_dir, "secret_our_compat.json")
        with open(path, encoding="utf-8") as f:
            keystore = json.load(f)

        decrypted = Account.decrypt(keystore, password)
        assert bytes(decrypted) == key

    def test_roundtrip_both_directions(self, secrets_dir):
        from eth_account import Account

        key = os.urandom(32)
        password = "cross-compat-pw"

        eth_ks = dict(Account.encrypt(key, password))
        path1 = os.path.join(secrets_dir, "secret_dir1.json")
        with open(path1, "w", encoding="utf-8") as f:
            json.dump(eth_ks, f)
        store = SecureKVStore(secrets_dir, password)
        assert store.load_secret("dir1") == key

        store.save_secret("dir2", key)
        path2 = os.path.join(secrets_dir, "secret_dir2.json")
        with open(path2, encoding="utf-8") as f:
            our_ks = json.load(f)
        assert bytes(Account.decrypt(our_ks, password)) == key


class TestCrossPassword:
    def test_secret_wrong_password(self, secrets_dir):
        store1 = SecureKVStore(secrets_dir, "password-A")
        store1.init_master()
        secret = os.urandom(32)
        store1.save_secret("wallet", secret)

        store2 = SecureKVStore(secrets_dir, "password-B")
        with pytest.raises((DecryptionError, Exception)):
            store2.load_secret("wallet")
