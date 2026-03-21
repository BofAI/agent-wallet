"""Tests that resolve_wallet_provider / resolve_wallet / get_active_wallet always
throw when no valid wallet can be resolved -- no silent fallback to a default or
empty wallet in any code path."""

from __future__ import annotations

import pytest

from agent_wallet import resolve_wallet, resolve_wallet_provider
from agent_wallet.core.config import WalletConfig, WalletsTopology, save_config
from agent_wallet.core.errors import WalletNotFoundError
from agent_wallet.core.providers import ConfigWalletProvider, EnvWalletProvider
from agent_wallet.local.secret_loader import load_local_secret


@pytest.fixture(autouse=True)
def clear_wallet_env(monkeypatch):
    for key in (
        "AGENT_WALLET_PASSWORD",
        "AGENT_WALLET_DIR",
        "AGENT_WALLET_PRIVATE_KEY",
        "TRON_PRIVATE_KEY",
        "AGENT_WALLET_MNEMONIC",
        "TRON_MNEMONIC",
        "AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX",
        "TRON_ACCOUNT_INDEX",
    ):
        monkeypatch.delenv(key, raising=False)


# ---------------------------------------------------------------------------
# resolve_wallet_provider
# ---------------------------------------------------------------------------


class TestResolveWalletProviderFallback:
    def test_falls_back_to_env_provider_when_no_config_or_password(self, tmp_path):
        provider = resolve_wallet_provider(dir=str(tmp_path))
        assert isinstance(provider, EnvWalletProvider)


# ---------------------------------------------------------------------------
# resolve_wallet -- end-to-end: must throw when no valid source
# ---------------------------------------------------------------------------


class TestResolveWalletNoSource:
    @pytest.mark.asyncio
    async def test_throws_evm(self, tmp_path):
        with pytest.raises(ValueError, match="could not find a wallet source"):
            await resolve_wallet(dir=str(tmp_path), network="eip155")

    @pytest.mark.asyncio
    async def test_throws_tron(self, tmp_path):
        with pytest.raises(ValueError, match="could not find a wallet source"):
            await resolve_wallet(dir=str(tmp_path), network="tron")

    @pytest.mark.asyncio
    async def test_throws_when_no_network_and_no_source(self, tmp_path):
        with pytest.raises(ValueError):
            await resolve_wallet(dir=str(tmp_path))


# ---------------------------------------------------------------------------
# EnvWalletProvider.get_active_wallet -- every failure path
# ---------------------------------------------------------------------------


class TestEnvWalletProviderGetActiveWallet:
    @pytest.mark.asyncio
    async def test_throws_without_private_key_or_mnemonic(self):
        provider = EnvWalletProvider(network="eip155")
        with pytest.raises(ValueError, match="could not find a wallet source"):
            await provider.get_active_wallet()

    @pytest.mark.asyncio
    async def test_throws_without_network_with_private_key(self):
        provider = EnvWalletProvider(
            private_key="4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b",
        )
        with pytest.raises(ValueError, match="network is required"):
            await provider.get_active_wallet()

    @pytest.mark.asyncio
    async def test_throws_without_network_with_mnemonic(self):
        provider = EnvWalletProvider(
            mnemonic="test test test test test test test test test test test junk",
        )
        with pytest.raises(ValueError, match="network is required"):
            await provider.get_active_wallet()

    def test_constructor_throws_when_both_sources_provided(self):
        with pytest.raises(ValueError, match="Provide only one of"):
            EnvWalletProvider(
                private_key="deadbeef",
                mnemonic="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            )


# ---------------------------------------------------------------------------
# ConfigWalletProvider.get_active_wallet -- every failure path
# ---------------------------------------------------------------------------


class TestConfigWalletProviderGetActiveWallet:
    @pytest.mark.asyncio
    async def test_throws_when_zero_wallets(self, tmp_path):
        save_config(str(tmp_path), WalletsTopology(active_wallet=None, wallets={}))
        provider = ConfigWalletProvider(
            str(tmp_path), network="eip155", secret_loader=load_local_secret,
        )
        with pytest.raises(WalletNotFoundError, match="No active wallet set"):
            await provider.get_active_wallet()

    @pytest.mark.asyncio
    async def test_throws_when_active_wallet_points_to_nonexistent_id(self, tmp_path):
        save_config(str(tmp_path), WalletsTopology(active_wallet="ghost", wallets={}))
        provider = ConfigWalletProvider(
            str(tmp_path), network="eip155", secret_loader=load_local_secret,
        )
        with pytest.raises(WalletNotFoundError, match="ghost"):
            await provider.get_active_wallet()

    @pytest.mark.asyncio
    async def test_throws_when_all_wallets_are_local_secure_without_password(self, tmp_path):
        config = WalletsTopology(
            active_wallet=None,
            wallets={
                "secure1": WalletConfig(type="local_secure", params={"secret_ref": "sec1"}),
                "secure2": WalletConfig(type="local_secure", params={"secret_ref": "sec2"}),
            },
        )
        save_config(str(tmp_path), config)
        provider = ConfigWalletProvider(
            str(tmp_path), network="eip155", secret_loader=load_local_secret,
        )
        with pytest.raises(ValueError, match="Password required for local_secure wallets"):
            await provider.get_active_wallet()

    @pytest.mark.asyncio
    async def test_throws_when_active_is_local_secure_with_wrong_password_no_fallback(self, tmp_path):
        config = WalletsTopology(
            active_wallet="secure",
            wallets={
                "secure": WalletConfig(type="local_secure", params={"secret_ref": "secure"}),
                "hot": WalletConfig(
                    type="raw_secret",
                    params={
                        "source": "private_key",
                        "private_key": "0xdeadbeef",
                    },
                ),
            },
        )
        save_config(str(tmp_path), config)
        # active is 'secure' -- should NOT silently fall back to 'hot'
        provider = ConfigWalletProvider(
            str(tmp_path), password="wrong-pw", network="eip155", secret_loader=load_local_secret,
        )
        with pytest.raises((ValueError, WalletNotFoundError, FileNotFoundError)):
            await provider.get_active_wallet()

    @pytest.mark.asyncio
    async def test_throws_when_network_is_missing(self, tmp_path):
        config = WalletsTopology(
            active_wallet="hot",
            wallets={
                "hot": WalletConfig(
                    type="raw_secret",
                    params={
                        "source": "private_key",
                        "private_key": "0x4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b",
                    },
                ),
            },
        )
        save_config(str(tmp_path), config)
        provider = ConfigWalletProvider(
            str(tmp_path), secret_loader=load_local_secret,
        )
        with pytest.raises(ValueError, match="network is required"):
            await provider.get_active_wallet()

    @pytest.mark.asyncio
    async def test_throws_on_get_wallet_with_nonexistent_id(self, tmp_path):
        save_config(str(tmp_path), WalletsTopology(active_wallet=None, wallets={}))
        provider = ConfigWalletProvider(
            str(tmp_path), network="eip155", secret_loader=load_local_secret,
        )
        with pytest.raises(WalletNotFoundError):
            await provider.get_wallet("nope", "eip155")
