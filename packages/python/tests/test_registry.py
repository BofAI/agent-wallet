"""Tests for wallet providers and env-driven resolver behavior."""

import os
import tempfile

import pytest

from agent_wallet.core.errors import DecryptionError, WalletNotFoundError
from agent_wallet.core.providers import (
    EnvProviderOptions,
    LocalProviderOptions,
    LocalWalletProvider,
    MnemonicProviderOptions,
    PrivateKeyProviderOptions,
    StaticWalletProvider,
    WalletProvider,
    create_wallet_provider,
    resolve_wallet_provider,
)
from agent_wallet.local.config import WalletConfig, WalletsTopology, save_config
from agent_wallet.local.kv_store import SecureKVStore

TEST_PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b"
TEST_MNEMONIC = "test test test test test test test test test test test junk"
TEST_EVM_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
TEST_EVM_ADDRESS_INDEX_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"


@pytest.fixture
def setup_evm_secrets():
    """Set up a secrets dir with master.json + one active EVM wallet."""
    with tempfile.TemporaryDirectory() as tmpdir:
        password = "test-registry-pw"
        kv = SecureKVStore(tmpdir, password)
        kv.init_master()

        key = os.urandom(32)
        kv.save_private_key("id_eth_test", key)

        config = WalletsTopology(
            active_wallet="eth_test",
            wallets={
                "eth_test": WalletConfig(
                    type="evm_local",
                    identity_file="id_eth_test",
                ),
            },
        )
        save_config(tmpdir, config)

        yield tmpdir, password


@pytest.fixture(autouse=True)
def clear_wallet_env(monkeypatch):
    for key in (
        "AGENT_WALLET_PASSWORD",
        "AGENT_WALLET_DIR",
        "AGENT_WALLET_PRIVATE_KEY",
        "AGENT_WALLET_MNEMONIC",
        "AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX",
    ):
        monkeypatch.delenv(key, raising=False)


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
    async def test_get_active_wallet(self, setup_evm_secrets):
        tmpdir, password = setup_evm_secrets
        provider = LocalWalletProvider(secrets_dir=tmpdir, password=password)
        wallet = await provider.get_active_wallet()
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


class TestResolveWalletProvider:
    def test_local_mode(self, setup_evm_secrets, monkeypatch):
        tmpdir, password = setup_evm_secrets
        monkeypatch.setenv("AGENT_WALLET_PASSWORD", password)
        monkeypatch.setenv("AGENT_WALLET_DIR", tmpdir)
        provider = resolve_wallet_provider()
        assert isinstance(provider, LocalWalletProvider)

    def test_local_mode_takes_precedence_over_generic_env(
        self, setup_evm_secrets, monkeypatch
    ):
        tmpdir, password = setup_evm_secrets
        monkeypatch.setenv("AGENT_WALLET_PASSWORD", password)
        monkeypatch.setenv("AGENT_WALLET_DIR", tmpdir)
        monkeypatch.setenv("AGENT_WALLET_PRIVATE_KEY", TEST_PRIVATE_KEY)
        provider = resolve_wallet_provider()
        assert isinstance(provider, LocalWalletProvider)

    def test_evm_private_key_mode(self, monkeypatch):
        monkeypatch.setenv("AGENT_WALLET_PRIVATE_KEY", TEST_PRIVATE_KEY)
        provider = resolve_wallet_provider(network="eip155")
        assert isinstance(provider, StaticWalletProvider)

    def test_missing_env(self):
        with pytest.raises(ValueError, match="resolve_wallet_provider requires one of"):
            resolve_wallet_provider()

    def test_missing_network_for_generic_env(self, monkeypatch):
        monkeypatch.setenv("AGENT_WALLET_PRIVATE_KEY", TEST_PRIVATE_KEY)
        with pytest.raises(ValueError, match="requires network"):
            resolve_wallet_provider()

    def test_conflicting_generic_env(self, monkeypatch):
        monkeypatch.setenv("AGENT_WALLET_PRIVATE_KEY", TEST_PRIVATE_KEY)
        monkeypatch.setenv("AGENT_WALLET_MNEMONIC", TEST_MNEMONIC)
        with pytest.raises(
            ValueError,
            match="AGENT_WALLET_PRIVATE_KEY or AGENT_WALLET_MNEMONIC",
        ):
            resolve_wallet_provider(network="tron")

    @pytest.mark.asyncio
    async def test_evm_mnemonic_mode(self, monkeypatch):
        monkeypatch.setenv("AGENT_WALLET_MNEMONIC", TEST_MNEMONIC)
        provider = resolve_wallet_provider(network="eip155:1")
        wallet = await provider.get_active_wallet()
        assert await wallet.get_address() == TEST_EVM_ADDRESS

    @pytest.mark.asyncio
    async def test_tron_mnemonic_mode(self, monkeypatch):
        monkeypatch.setenv("AGENT_WALLET_MNEMONIC", TEST_MNEMONIC)
        provider = resolve_wallet_provider(network="tron:nile")
        wallet = await provider.get_active_wallet()
        assert (await wallet.get_address()).startswith("T")

    @pytest.mark.asyncio
    async def test_evm_mnemonic_mode_with_account_index(self, monkeypatch):
        monkeypatch.setenv("AGENT_WALLET_MNEMONIC", TEST_MNEMONIC)
        monkeypatch.setenv("AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX", "1")
        provider = resolve_wallet_provider(network="eip155:1")
        wallet = await provider.get_active_wallet()
        assert await wallet.get_address() == TEST_EVM_ADDRESS_INDEX_1

    def test_invalid_network_prefix(self, monkeypatch):
        monkeypatch.setenv("AGENT_WALLET_PRIVATE_KEY", TEST_PRIVATE_KEY)
        with pytest.raises(ValueError, match="network must start with 'tron' or 'eip155'"):
            resolve_wallet_provider(network="solana:devnet")

    def test_invalid_account_index(self, monkeypatch):
        monkeypatch.setenv("AGENT_WALLET_MNEMONIC", TEST_MNEMONIC)
        monkeypatch.setenv("AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX", "-1")
        with pytest.raises(
            ValueError,
            match="AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX must be a non-negative integer",
        ):
            resolve_wallet_provider(network="eip155")


class TestCreateWalletProvider:
    def test_explicit_local_mode(self, setup_evm_secrets):
        tmpdir, password = setup_evm_secrets
        provider = create_wallet_provider(
            LocalProviderOptions(secrets_dir=tmpdir, password=password)
        )
        assert isinstance(provider, LocalWalletProvider)

    @pytest.mark.asyncio
    async def test_explicit_private_key(self):
        provider = create_wallet_provider(
            PrivateKeyProviderOptions(private_key=TEST_PRIVATE_KEY, network="eip155")
        )
        assert isinstance(provider, StaticWalletProvider)
        wallet = await provider.get_active_wallet()
        assert (await wallet.get_address()).startswith("0x")

    @pytest.mark.asyncio
    async def test_explicit_mnemonic_evm(self):
        provider = create_wallet_provider(
            MnemonicProviderOptions(mnemonic=TEST_MNEMONIC, network="eip155:1")
        )
        wallet = await provider.get_active_wallet()
        assert await wallet.get_address() == TEST_EVM_ADDRESS

    @pytest.mark.asyncio
    async def test_explicit_mnemonic_tron(self):
        provider = create_wallet_provider(
            MnemonicProviderOptions(mnemonic=TEST_MNEMONIC, network="tron:nile")
        )
        wallet = await provider.get_active_wallet()
        assert (await wallet.get_address()).startswith("T")

    @pytest.mark.asyncio
    async def test_explicit_mnemonic_with_account_index(self):
        provider = create_wallet_provider(
            MnemonicProviderOptions(
                mnemonic=TEST_MNEMONIC, network="eip155:1", account_index=1
            )
        )
        wallet = await provider.get_active_wallet()
        assert await wallet.get_address() == TEST_EVM_ADDRESS_INDEX_1

    @pytest.mark.asyncio
    async def test_explicit_tron_private_key(self):
        provider = create_wallet_provider(
            PrivateKeyProviderOptions(private_key=TEST_PRIVATE_KEY, network="tron")
        )
        assert isinstance(provider, StaticWalletProvider)
        wallet = await provider.get_active_wallet()
        assert (await wallet.get_address()).startswith("T")

    def test_no_options_no_env(self):
        with pytest.raises(ValueError, match="resolve_wallet_provider requires one of"):
            create_wallet_provider()

    def test_invalid_private_key_wrong_length(self):
        with pytest.raises(ValueError, match="Private key must be 32 bytes"):
            create_wallet_provider(
                PrivateKeyProviderOptions(private_key="0xabc", network="eip155")
            )

    def test_invalid_private_key_bad_hex(self):
        with pytest.raises(ValueError, match="Private key must be a valid hex string"):
            create_wallet_provider(
                PrivateKeyProviderOptions(
                    private_key="z" * 64, network="eip155"
                )
            )

    def test_missing_network_for_private_key(self):
        with pytest.raises(ValueError, match="requires network"):
            create_wallet_provider(
                PrivateKeyProviderOptions(private_key=TEST_PRIVATE_KEY, network="")
            )

    def test_missing_network_for_mnemonic(self):
        with pytest.raises(ValueError, match="requires network"):
            create_wallet_provider(
                MnemonicProviderOptions(mnemonic=TEST_MNEMONIC, network="")
            )

    def test_fallback_to_env(self, setup_evm_secrets, monkeypatch):
        tmpdir, password = setup_evm_secrets
        monkeypatch.setenv("AGENT_WALLET_PASSWORD", password)
        monkeypatch.setenv("AGENT_WALLET_DIR", tmpdir)
        provider = create_wallet_provider()
        assert isinstance(provider, LocalWalletProvider)

    def test_fallback_to_env_with_explicit_options(self, monkeypatch):
        monkeypatch.setenv("AGENT_WALLET_PRIVATE_KEY", TEST_PRIVATE_KEY)
        provider = create_wallet_provider(EnvProviderOptions(network="eip155"))
        assert isinstance(provider, StaticWalletProvider)


@pytest.mark.asyncio
async def test_evm_wallet_sign_via_provider(setup_evm_secrets):
    """End-to-end: local provider → get_wallet → sign_message."""
    tmpdir, password = setup_evm_secrets
    provider = LocalWalletProvider(secrets_dir=tmpdir, password=password)
    wallet = await provider.get_wallet("eth_test")
    addr = await wallet.get_address()
    assert addr.startswith("0x")
    sig = await wallet.sign_message(b"hello from provider")
    assert len(sig) > 0


@pytest.mark.asyncio
async def test_evm_wallet_sign_via_factory_env(monkeypatch):
    """End-to-end: env factory → active wallet → sign_message."""
    monkeypatch.setenv("AGENT_WALLET_PRIVATE_KEY", TEST_PRIVATE_KEY)
    provider = resolve_wallet_provider(network="eip155")
    wallet = await provider.get_active_wallet()
    addr = await wallet.get_address()
    assert addr.startswith("0x")
    sig = await wallet.sign_message(b"hello from env provider")
    assert len(sig) > 0
