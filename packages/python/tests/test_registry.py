"""Tests for wallet resolution behavior."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from agent_wallet import resolve_wallet, resolve_wallet_provider
from agent_wallet.core.config import (
    LocalSecureWalletConfig,
    RawSecretPrivateKeyConfig,
    RawSecretWalletConfig,
    WalletsTopology,
    save_config,
)
from agent_wallet.core.errors import DecryptionError, WalletNotFoundError
from agent_wallet.core.providers import ConfigWalletProvider, EnvWalletProvider
from agent_wallet.local.kv_store import SecureKVStore
from agent_wallet.local.secret_loader import load_local_secret

TEST_PASSWORD = "test-registry-pw"
TEST_PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b"
TEST_MNEMONIC = "test test test test test test test test test test test junk"
TEST_EVM_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
TEST_EVM_ADDRESS_INDEX_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
TEST_ENV_PRIVATE_KEY_ADDRESS = "0x71575b840BCA06B0c80224f42017A40A171fB134"


def _write_password_config(tmpdir: str, password: str) -> None:
    (Path(tmpdir) / "runtime_secrets.json").write_text(
        json.dumps({"password": password}),
        encoding="utf-8",
    )


def _write_raw_private_key_config(tmp_path: Path, *, active_wallet: str = "hot") -> None:
    (tmp_path / "wallets_config.json").write_text(
        json.dumps(
            {
                "active_wallet": active_wallet,
                "wallets": {
                    active_wallet: {
                        "type": "raw_secret",
                        "material": {
                            "source": "private_key",
                            "private_key": TEST_PRIVATE_KEY,
                        },
                    }
                },
            }
        ),
        encoding="utf-8",
    )


@pytest.fixture
def setup_local_secure_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        kv = SecureKVStore(tmpdir, TEST_PASSWORD)
        kv.init_master()
        kv.save_secret("eth_test", bytes.fromhex(TEST_PRIVATE_KEY.removeprefix("0x")))

        config = WalletsTopology(
            active_wallet="eth_test",
            wallets={
                "eth_test": LocalSecureWalletConfig(
                    type="local_secure",
                    secret_ref="eth_test",
                ),
            },
        )
        save_config(tmpdir, config)
        yield tmpdir


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


class TestConfigWalletProvider:
    @pytest.mark.asyncio
    async def test_get_active_wallet_local_secure(self, setup_local_secure_dir):
        provider = ConfigWalletProvider(
            setup_local_secure_dir,
            password=TEST_PASSWORD,
            secret_loader=load_local_secret,
        )
        wallet = await provider.get_active_wallet("eip155")
        assert await wallet.get_address() == TEST_ENV_PRIVATE_KEY_ADDRESS

    @pytest.mark.asyncio
    async def test_get_wallet_not_found(self, setup_local_secure_dir):
        provider = ConfigWalletProvider(
            setup_local_secure_dir,
            password=TEST_PASSWORD,
            secret_loader=load_local_secret,
        )
        with pytest.raises(WalletNotFoundError):
            await provider.get_wallet("missing", "eip155")

    @pytest.mark.asyncio
    async def test_wrong_password_raises_on_wallet_access(self, setup_local_secure_dir):
        provider = ConfigWalletProvider(
            setup_local_secure_dir,
            password="wrong-password",
            secret_loader=load_local_secret,
        )
        with pytest.raises(DecryptionError):
            await provider.get_active_wallet("eip155")

    @pytest.mark.asyncio
    async def test_raw_secret_private_key_config(self, tmp_path):
        _write_raw_private_key_config(tmp_path)
        provider = ConfigWalletProvider(str(tmp_path), secret_loader=load_local_secret)
        wallet = await provider.get_active_wallet("eip155")
        assert await wallet.get_address() == TEST_ENV_PRIVATE_KEY_ADDRESS

    @pytest.mark.asyncio
    async def test_get_active_wallet_uses_provider_default_network(self, tmp_path):
        _write_raw_private_key_config(tmp_path)
        provider = ConfigWalletProvider(
            str(tmp_path),
            network="eip155",
            secret_loader=load_local_secret,
        )
        wallet = await provider.get_active_wallet()
        assert await wallet.get_address() == TEST_ENV_PRIVATE_KEY_ADDRESS

    @pytest.mark.asyncio
    async def test_active_local_secure_without_password_does_not_fallback(
        self, tmp_path
    ):
        (tmp_path / "wallets_config.json").write_text(
            json.dumps(
                {
                    "active_wallet": "secure",
                    "wallets": {
                        "secure": {
                            "type": "local_secure",
                            "secret_ref": "secure",
                        },
                        "hot": {
                            "type": "raw_secret",
                            "material": {
                                "source": "private_key",
                                "private_key": TEST_PRIVATE_KEY,
                            },
                        },
                    },
                }
            ),
            encoding="utf-8",
        )
        provider = ConfigWalletProvider(str(tmp_path), secret_loader=load_local_secret)
        with pytest.raises(ValueError, match="Password required"):
            await provider.get_active_wallet("eip155")

    @pytest.mark.asyncio
    async def test_no_password_and_only_local_secure_raises(self, tmp_path):
        (tmp_path / "wallets_config.json").write_text(
            json.dumps(
                {
                    "active_wallet": "secure",
                    "wallets": {
                        "secure": {
                            "type": "local_secure",
                            "secret_ref": "secure",
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        provider = ConfigWalletProvider(str(tmp_path), secret_loader=load_local_secret)
        with pytest.raises(ValueError, match="Password required"):
            await provider.get_active_wallet("eip155")

    @pytest.mark.asyncio
    async def test_raw_secret_mnemonic_config(self, tmp_path):
        (tmp_path / "wallets_config.json").write_text(
            json.dumps(
                {
                    "active_wallet": "seed",
                    "wallets": {
                        "seed": {
                            "type": "raw_secret",
                            "material": {
                                "source": "mnemonic",
                                "mnemonic": TEST_MNEMONIC,
                                "account_index": 1,
                            },
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        provider = ConfigWalletProvider(str(tmp_path), secret_loader=load_local_secret)
        wallet = await provider.get_active_wallet("eip155:1")
        assert await wallet.get_address() == TEST_EVM_ADDRESS_INDEX_1

    def test_add_wallet_duplicate_raises(self, tmp_path):
        _write_raw_private_key_config(tmp_path)
        provider = ConfigWalletProvider(str(tmp_path), secret_loader=load_local_secret)
        with pytest.raises(ValueError, match="already exists"):
            provider.add_wallet(
                "hot",
                RawSecretWalletConfig(
                    type="raw_secret",
                    material=RawSecretPrivateKeyConfig(
                        source="private_key",
                        private_key=TEST_PRIVATE_KEY,
                    ),
                ),
            )

    @pytest.mark.asyncio
    async def test_set_active_persists(self, tmp_path):
        _write_raw_private_key_config(tmp_path, active_wallet="a")
        provider = ConfigWalletProvider(str(tmp_path), secret_loader=load_local_secret)
        provider.add_wallet(
            "b",
            RawSecretWalletConfig(
                type="raw_secret",
                material=RawSecretPrivateKeyConfig(
                    source="private_key",
                    private_key=TEST_PRIVATE_KEY,
                ),
            ),
        )
        provider.set_active("b")
        reloaded = ConfigWalletProvider(str(tmp_path), secret_loader=load_local_secret)
        assert reloaded.get_active_id() == "b"

    @pytest.mark.asyncio
    async def test_remove_wallet_deletes_secret_and_clears_active(self, setup_local_secure_dir):
        provider = ConfigWalletProvider(
            setup_local_secure_dir,
            password=TEST_PASSWORD,
            secret_loader=load_local_secret,
        )
        secret_path = Path(setup_local_secure_dir) / "secret_eth_test.json"
        assert secret_path.exists()
        removed = provider.remove_wallet("eth_test")
        assert removed.type == "local_secure"
        assert not secret_path.exists()
        assert provider.get_active_id() is None

    @pytest.mark.asyncio
    async def test_get_wallet_local_secure_without_secret_loader_raises(self, setup_local_secure_dir):
        provider = ConfigWalletProvider(
            setup_local_secure_dir,
            password=TEST_PASSWORD,
            secret_loader=None,
        )
        with pytest.raises(ValueError, match="secret loader"):
            await provider.get_wallet("eth_test", "eip155")

    @pytest.mark.asyncio
    async def test_get_active_wallet_without_any_network_raises(self, tmp_path):
        _write_raw_private_key_config(tmp_path)
        provider = ConfigWalletProvider(str(tmp_path), secret_loader=load_local_secret)
        with pytest.raises(ValueError, match="network is required"):
            await provider.get_active_wallet()


class TestEnvWalletProvider:
    @pytest.mark.asyncio
    async def test_private_key_evm(self):
        provider = EnvWalletProvider(
            network="eip155",
            private_key=TEST_PRIVATE_KEY,
        )
        wallet = await provider.get_wallet()
        assert await wallet.get_address() == TEST_ENV_PRIVATE_KEY_ADDRESS

    @pytest.mark.asyncio
    async def test_mnemonic_tron(self):
        provider = EnvWalletProvider(
            network="tron:nile",
            mnemonic=TEST_MNEMONIC,
        )
        wallet = await provider.get_wallet()
        assert (await wallet.get_address()).startswith("T")

    @pytest.mark.asyncio
    async def test_mnemonic_account_index(self):
        provider = EnvWalletProvider(
            network="eip155:1",
            mnemonic=TEST_MNEMONIC,
            account_index=1,
        )
        wallet = await provider.get_wallet()
        assert await wallet.get_address() == TEST_EVM_ADDRESS_INDEX_1

    def test_conflicting_sources(self):
        with pytest.raises(ValueError, match="Provide only one of"):
            EnvWalletProvider(
                network="eip155",
                private_key=TEST_PRIVATE_KEY,
                mnemonic=TEST_MNEMONIC,
            )

    @pytest.mark.asyncio
    async def test_missing_sources(self):
        provider = EnvWalletProvider(network="eip155")
        with pytest.raises(ValueError, match="could not find a wallet source"):
            await provider.get_wallet()

    @pytest.mark.asyncio
    async def test_get_wallet_alias(self):
        provider = EnvWalletProvider(
            network="eip155",
            private_key=TEST_PRIVATE_KEY,
        )
        wallet = await provider.get_wallet()
        assert await wallet.get_address() == TEST_ENV_PRIVATE_KEY_ADDRESS

    @pytest.mark.asyncio
    async def test_get_active_wallet_uses_provider_default_network(self):
        provider = EnvWalletProvider(
            network="eip155",
            private_key=TEST_PRIVATE_KEY,
        )
        wallet = await provider.get_active_wallet()
        assert await wallet.get_address() == TEST_ENV_PRIVATE_KEY_ADDRESS

    @pytest.mark.asyncio
    async def test_constructor_allows_missing_network_until_access(self):
        provider = EnvWalletProvider(private_key=TEST_PRIVATE_KEY)
        with pytest.raises(ValueError, match="network is required"):
            await provider.get_wallet()


class TestResolveWallet:
    def test_resolve_wallet_provider_prefers_config(self, setup_local_secure_dir):
        provider = resolve_wallet_provider(
            dir=setup_local_secure_dir,
            network="eip155",
        )
        assert isinstance(provider, ConfigWalletProvider)

    def test_resolve_wallet_provider_falls_back_to_env(self, monkeypatch, tmp_path):
        monkeypatch.setenv("AGENT_WALLET_PRIVATE_KEY", TEST_PRIVATE_KEY)
        provider = resolve_wallet_provider(
            dir=str(tmp_path),
            network="eip155",
        )
        assert isinstance(provider, EnvWalletProvider)

    @pytest.mark.asyncio
    async def test_password_file_takes_precedence(self, setup_local_secure_dir, monkeypatch):
        _write_password_config(setup_local_secure_dir, TEST_PASSWORD)
        monkeypatch.setenv("AGENT_WALLET_PRIVATE_KEY", TEST_PRIVATE_KEY)

        wallet = await resolve_wallet(dir=setup_local_secure_dir, network="eip155")
        assert await wallet.get_address() == TEST_ENV_PRIVATE_KEY_ADDRESS

    @pytest.mark.asyncio
    async def test_env_password_fallback_uses_config(self, setup_local_secure_dir, monkeypatch):
        monkeypatch.setenv("AGENT_WALLET_PASSWORD", TEST_PASSWORD)
        monkeypatch.setenv("AGENT_WALLET_DIR", setup_local_secure_dir)

        wallet = await resolve_wallet(network="eip155")
        assert await wallet.get_address() == TEST_ENV_PRIVATE_KEY_ADDRESS

    @pytest.mark.asyncio
    async def test_non_local_active_wallet_from_config_without_password(self, tmp_path):
        _write_raw_private_key_config(tmp_path)
        wallet = await resolve_wallet(dir=str(tmp_path), network="eip155")
        assert await wallet.get_address() == TEST_ENV_PRIVATE_KEY_ADDRESS

    @pytest.mark.asyncio
    async def test_fallback_to_first_non_local_wallet(self, tmp_path):
        (tmp_path / "wallets_config.json").write_text(
            json.dumps(
                {
                    "wallets": {
                        "secure": {
                            "type": "local_secure",
                            "secret_ref": "secure",
                        },
                        "hot": {
                            "type": "raw_secret",
                            "material": {
                                "source": "private_key",
                                "private_key": TEST_PRIVATE_KEY,
                            },
                        },
                    },
                }
            ),
            encoding="utf-8",
        )
        wallet = await resolve_wallet(dir=str(tmp_path), network="eip155")
        assert await wallet.get_address() == TEST_ENV_PRIVATE_KEY_ADDRESS

    @pytest.mark.asyncio
    async def test_env_private_key_fallback(self, monkeypatch, tmp_path):
        monkeypatch.setenv("AGENT_WALLET_PRIVATE_KEY", TEST_PRIVATE_KEY)
        wallet = await resolve_wallet(dir=str(tmp_path), network="eip155")
        assert await wallet.get_address() == TEST_ENV_PRIVATE_KEY_ADDRESS

    @pytest.mark.asyncio
    async def test_env_mnemonic_fallback(self, monkeypatch, tmp_path):
        monkeypatch.setenv("AGENT_WALLET_MNEMONIC", TEST_MNEMONIC)
        wallet = await resolve_wallet(dir=str(tmp_path), network="eip155:1")
        assert await wallet.get_address() == TEST_EVM_ADDRESS

    @pytest.mark.asyncio
    async def test_sign_message_from_resolved_wallet(self, monkeypatch, tmp_path):
        monkeypatch.setenv("AGENT_WALLET_PRIVATE_KEY", TEST_PRIVATE_KEY)
        wallet = await resolve_wallet(dir=str(tmp_path), network="eip155")
        signature = await wallet.sign_message(b"hello from resolved wallet")
        assert len(signature) > 0

    @pytest.mark.asyncio
    async def test_missing_all_sources_raises(self, tmp_path):
        with pytest.raises(ValueError, match="could not find a wallet source"):
            await resolve_wallet(dir=str(tmp_path), network="eip155")

    @pytest.mark.asyncio
    async def test_missing_network_for_config_resolution(self, setup_local_secure_dir):
        with pytest.raises(ValueError, match="network is required"):
            await resolve_wallet(dir=setup_local_secure_dir)

    @pytest.mark.asyncio
    async def test_invalid_network_prefix(self, monkeypatch, tmp_path):
        monkeypatch.setenv("AGENT_WALLET_PRIVATE_KEY", TEST_PRIVATE_KEY)
        with pytest.raises(ValueError, match="network must start with"):
            await resolve_wallet(dir=str(tmp_path), network="solana:devnet")
