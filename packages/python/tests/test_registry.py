"""Tests for WalletProvider — LocalWalletProvider + RemoteWalletProvider."""

import os
import tempfile

import pytest

from agent_wallet.core.errors import DecryptionError, WalletNotFoundError
from agent_wallet.core.provider import (
    LocalWalletProvider,
    RemoteWalletProvider,
    WalletProvider,
    WalletFactory,
)
from agent_wallet.local.kv_store import SecureKVStore
from agent_wallet.local.config import WalletConfig, WalletsTopology, save_config


@pytest.fixture
def setup_evm_secrets():
    """Set up a secrets dir with master.json + one EVM wallet."""
    with tempfile.TemporaryDirectory() as tmpdir:
        password = "test-registry-pw"
        kv = SecureKVStore(tmpdir, password)
        kv.init_master()

        # Generate a test key
        key = os.urandom(32)
        kv.save_private_key("id_eth_test", key)

        # Write config
        config = WalletsTopology(
            wallets={
                "eth_test": WalletConfig(
                    type="evm_local",
                    identity_file="id_eth_test",
                ),
            }
        )
        save_config(tmpdir, config)

        yield tmpdir, password


class TestLocalWalletProvider:
    @pytest.mark.asyncio
    async def test_init(self, setup_evm_secrets):
        tmpdir, password = setup_evm_secrets
        provider = LocalWalletProvider(secrets_dir=tmpdir, password=password)
        assert isinstance(provider, WalletProvider)
        wallets = await provider.list_wallets()
        assert len(wallets) == 1
        assert wallets[0].id == "eth_test"
        assert wallets[0].type == "evm_local"

    @pytest.mark.asyncio
    async def test_get_wallet(self, setup_evm_secrets):
        tmpdir, password = setup_evm_secrets
        provider = LocalWalletProvider(secrets_dir=tmpdir, password=password)
        wallet = await provider.get_wallet("eth_test")
        assert wallet is not None

    @pytest.mark.asyncio
    async def test_get_wallet_not_found(self, setup_evm_secrets):
        tmpdir, password = setup_evm_secrets
        provider = LocalWalletProvider(secrets_dir=tmpdir, password=password)
        with pytest.raises(WalletNotFoundError):
            await provider.get_wallet("nonexistent")

    def test_wrong_password(self, setup_evm_secrets):
        tmpdir, _ = setup_evm_secrets
        with pytest.raises(DecryptionError):
            LocalWalletProvider(secrets_dir=tmpdir, password="wrong-password")


class TestRemoteWalletProvider:
    def test_init(self):
        provider = RemoteWalletProvider(remote_url="http://localhost:8080")
        assert isinstance(provider, WalletProvider)

    @pytest.mark.asyncio
    async def test_get_wallet_returns_remote_wallet(self):
        from agent_wallet.core.adapters.remote import RemoteWallet

        provider = RemoteWalletProvider(
            remote_url="http://localhost:8080", token="test-token"
        )
        wallet = await provider.get_wallet("my_wallet")
        assert isinstance(wallet, RemoteWallet)

    @pytest.mark.asyncio
    async def test_list_wallets_not_implemented(self):
        provider = RemoteWalletProvider(remote_url="http://localhost:8080")
        with pytest.raises(NotImplementedError):
            await provider.list_wallets()


class TestWalletFactory:
    def test_local_mode(self, setup_evm_secrets):
        tmpdir, password = setup_evm_secrets
        provider = WalletFactory(secrets_dir=tmpdir, password=password)
        assert isinstance(provider, LocalWalletProvider)

    def test_remote_mode(self):
        provider = WalletFactory(remote_url="http://localhost:8080")
        assert isinstance(provider, RemoteWalletProvider)

    def test_missing_args(self):
        with pytest.raises(ValueError, match="Either"):
            WalletFactory()

    def test_missing_password(self):
        with pytest.raises(ValueError, match="password"):
            WalletFactory(secrets_dir="/tmp/fake")


@pytest.mark.asyncio
async def test_evm_wallet_sign_via_provider(setup_evm_secrets):
    """End-to-end: provider → get_wallet → sign_message."""
    tmpdir, password = setup_evm_secrets
    provider = LocalWalletProvider(secrets_dir=tmpdir, password=password)
    wallet = await provider.get_wallet("eth_test")
    addr = await wallet.get_address()
    assert addr.startswith("0x")
    sig = await wallet.sign_message(b"hello from provider")
    assert len(sig) > 0
