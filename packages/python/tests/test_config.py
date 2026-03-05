"""Tests for Storage layer — config loading, validation, and migration."""

import json
import tempfile
from pathlib import Path

import pytest

from agent_wallet.storage.config import (
    CURRENT_CONFIG_VERSION,
    WalletConfig,
    WalletsTopology,
    load_config,
    migrate_config,
    save_config,
)


@pytest.fixture
def secrets_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


class TestWalletConfig:
    def test_valid_evm(self):
        conf = WalletConfig(type="evm_local", identity_file="id_test", chain_id="eip155:1")
        assert conf.type == "evm_local"

    def test_valid_tron(self):
        conf = WalletConfig(
            type="tron_local",
            identity_file="id_tron",
            cred_file="cred_trongrid",
            chain_id="tron:mainnet",
        )
        assert conf.cred_file == "cred_trongrid"

    def test_invalid_type(self):
        with pytest.raises(ValueError):
            WalletConfig(type="solana_local")


class TestLoadSaveConfig:
    def test_roundtrip(self, secrets_dir):
        config = WalletsTopology(
            wallets={
                "eth_deployer": WalletConfig(
                    type="evm_local",
                    identity_file="id_eth_deployer",
                    chain_id="eip155:1",
                ),
                "tron_manager": WalletConfig(
                    type="tron_local",
                    identity_file="id_tron_manager",
                    cred_file="cred_trongrid",
                    chain_id="tron:mainnet",
                ),
            }
        )
        save_config(secrets_dir, config)
        loaded = load_config(secrets_dir)
        assert set(loaded.wallets.keys()) == {"eth_deployer", "tron_manager"}
        assert loaded.wallets["eth_deployer"].type == "evm_local"
        assert loaded.wallets["tron_manager"].cred_file == "cred_trongrid"

    def test_missing_file(self, secrets_dir):
        with pytest.raises(FileNotFoundError):
            load_config(secrets_dir)

    def test_invalid_json(self, secrets_dir):
        (secrets_dir / "wallets_config.json").write_text("not json")
        with pytest.raises(Exception):
            load_config(secrets_dir)

    def test_save_stamps_current_version(self, secrets_dir):
        config = WalletsTopology(wallets={})
        save_config(secrets_dir, config)
        raw = json.loads((secrets_dir / "wallets_config.json").read_text())
        assert raw["config_version"] == CURRENT_CONFIG_VERSION


class TestMigration:
    """Config migration from v0 (legacy) → current."""

    def test_migrate_v0_adds_version(self):
        """v0 config (no config_version) should gain config_version."""
        data = {"wallets": {"w1": {"type": "evm_local"}}}
        result = migrate_config(data)
        assert result["config_version"] == CURRENT_CONFIG_VERSION

    def test_migrate_v0_preserves_wallets(self):
        """Migration must not alter wallet entries."""
        data = {
            "wallets": {
                "eth": {
                    "type": "evm_local",
                    "address": "0xABC",
                    "identity_file": "eth",
                    "chain_id": "eip155:1",
                },
                "tron": {
                    "type": "tron_local",
                    "identity_file": "tron",
                    "cred_file": "tron",
                },
            }
        }
        result = migrate_config(data)
        assert result["wallets"]["eth"]["address"] == "0xABC"
        assert result["wallets"]["tron"]["cred_file"] == "tron"

    def test_migrate_current_is_noop(self):
        """Already-current config should pass through unchanged."""
        data = {"config_version": CURRENT_CONFIG_VERSION, "wallets": {}}
        result = migrate_config(data)
        assert result is data  # same object, no copy

    def test_migrate_future_version_raises(self):
        """Config from a newer SDK version should raise."""
        data = {"config_version": CURRENT_CONFIG_VERSION + 1, "wallets": {}}
        with pytest.raises(ValueError, match="newer than supported"):
            migrate_config(data)

    def test_load_auto_migrates_v0(self, secrets_dir):
        """load_config should auto-migrate a v0 file and persist the result."""
        # Write a v0 config (no config_version)
        v0 = {
            "wallets": {
                "my_wallet": {
                    "type": "evm_local",
                    "address": "0x123",
                    "identity_file": "my_wallet",
                }
            }
        }
        (secrets_dir / "wallets_config.json").write_text(json.dumps(v0))

        loaded = load_config(secrets_dir)
        assert loaded.config_version == CURRENT_CONFIG_VERSION
        assert loaded.wallets["my_wallet"].address == "0x123"

        # File on disk should now be updated
        raw = json.loads((secrets_dir / "wallets_config.json").read_text())
        assert raw["config_version"] == CURRENT_CONFIG_VERSION

    def test_load_current_version_no_rewrite(self, secrets_dir):
        """load_config should NOT rewrite a file that is already current."""
        config = WalletsTopology(wallets={})
        save_config(secrets_dir, config)

        path = secrets_dir / "wallets_config.json"
        mtime_before = path.stat().st_mtime_ns

        # Tiny sleep to ensure mtime would differ if rewritten
        import time
        time.sleep(0.01)

        load_config(secrets_dir)
        mtime_after = path.stat().st_mtime_ns
        assert mtime_before == mtime_after
