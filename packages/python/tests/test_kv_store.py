"""Tests for SecureKVStore — Keystore V3 encrypt/decrypt roundtrip."""

import json
import os
import tempfile

import pytest

from agent_wallet.core.errors import DecryptionError
from agent_wallet.local.kv_store import SecureKVStore


@pytest.fixture
def secrets_dir():
    """Create a temp secrets directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def kv_store(secrets_dir):
    """Create a KVStore with master.json initialized."""
    store = SecureKVStore(secrets_dir, password="test-password-123")
    store.init_master()
    return store


class TestMasterPassword:
    def test_init_and_verify(self, kv_store):
        assert kv_store.verify_password() is True

    def test_wrong_password(self, secrets_dir):
        # Init with one password
        store1 = SecureKVStore(secrets_dir, "correct-password")
        store1.init_master()

        # Verify with wrong password
        store2 = SecureKVStore(secrets_dir, "wrong-password")
        with pytest.raises(DecryptionError):
            store2.verify_password()

    def test_missing_master_json(self, secrets_dir):
        store = SecureKVStore(secrets_dir, "any-password")
        with pytest.raises(FileNotFoundError, match=r"master\.json"):
            store.verify_password()


class TestPrivateKey:
    def test_save_and_load_roundtrip(self, kv_store):
        key = os.urandom(32)
        kv_store.save_private_key("test_wallet", key)
        loaded = kv_store.load_private_key("test_wallet")
        assert loaded == key

    def test_generate_key(self, kv_store):
        key = kv_store.generate_key("gen_wallet")
        assert len(key) == 32
        # Should be loadable
        loaded = kv_store.load_private_key("gen_wallet")
        assert loaded == key

    def test_invalid_key_length(self, kv_store):
        with pytest.raises(ValueError, match="32 bytes"):
            kv_store.save_private_key("bad", b"too-short")

    def test_load_nonexistent(self, kv_store):
        with pytest.raises(FileNotFoundError):
            kv_store.load_private_key("nonexistent")


class TestCredential:
    def test_string_roundtrip(self, kv_store):
        kv_store.save_credential("api_key", "my-secret-api-key-12345")
        loaded = kv_store.load_credential("api_key")
        assert loaded == "my-secret-api-key-12345"

    def test_dict_roundtrip(self, kv_store):
        cred = {"api_key": "abc123", "api_secret": "xyz789", "extra": True}
        kv_store.save_credential("complex_cred", cred)
        loaded = kv_store.load_credential("complex_cred")
        assert loaded == cred

    def test_load_nonexistent(self, kv_store):
        with pytest.raises(FileNotFoundError):
            kv_store.load_credential("nonexistent")


class TestEthAccountCompat:
    """Verify our Keystore V3 implementation is compatible with eth_account."""

    def test_decrypt_eth_account_encrypted_key(self, kv_store, secrets_dir):
        """eth_account encrypts → our implementation decrypts."""
        from eth_account import Account

        key = os.urandom(32)
        password = "test-password-123"
        keystore = Account.encrypt(key, password)

        # Write eth_account's output as a keystore file
        path = os.path.join(secrets_dir, "id_eth_compat.json")
        with open(path, "w") as f:
            json.dump(dict(keystore), f)

        # Our implementation should decrypt it correctly
        loaded = kv_store.load_private_key("eth_compat")
        assert loaded == key

    def test_eth_account_decrypts_our_encrypted_key(self, kv_store, secrets_dir):
        """Our implementation encrypts → eth_account decrypts."""
        from eth_account import Account

        key = os.urandom(32)
        password = "test-password-123"
        kv_store.save_private_key("our_compat", key)

        # Read our output and decrypt with eth_account
        path = os.path.join(secrets_dir, "id_our_compat.json")
        with open(path) as f:
            keystore = json.load(f)

        decrypted = Account.decrypt(keystore, password)
        assert bytes(decrypted) == key

    def test_roundtrip_both_directions(self, secrets_dir):
        """Full roundtrip: same key survives both implementations."""
        from eth_account import Account

        key = os.urandom(32)
        password = "cross-compat-pw"

        # Direction 1: eth_account → ours → verify
        eth_ks = dict(Account.encrypt(key, password))
        path1 = os.path.join(secrets_dir, "id_dir1.json")
        with open(path1, "w") as f:
            json.dump(eth_ks, f)
        store = SecureKVStore(secrets_dir, password)
        assert store.load_private_key("dir1") == key

        # Direction 2: ours → eth_account → verify
        store.save_private_key("dir2", key)
        path2 = os.path.join(secrets_dir, "id_dir2.json")
        with open(path2) as f:
            our_ks = json.load(f)
        assert bytes(Account.decrypt(our_ks, password)) == key


class TestCrossPassword:
    """Verify that data encrypted with one password can't be decrypted with another."""

    def test_private_key_wrong_password(self, secrets_dir):
        store1 = SecureKVStore(secrets_dir, "password-A")
        store1.init_master()
        key = os.urandom(32)
        store1.save_private_key("wallet", key)

        store2 = SecureKVStore(secrets_dir, "password-B")
        with pytest.raises((DecryptionError, Exception)):
            store2.load_private_key("wallet")

    def test_credential_wrong_password(self, secrets_dir):
        store1 = SecureKVStore(secrets_dir, "password-A")
        store1.init_master()
        store1.save_credential("cred", "secret-value")

        store2 = SecureKVStore(secrets_dir, "password-B")
        with pytest.raises(DecryptionError):
            store2.load_credential("cred")
