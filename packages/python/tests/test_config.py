"""Tests for Storage layer — config loading and validation."""

import json
import tempfile
from pathlib import Path

import pytest

from agent_wallet.storage.config import WalletConfig, WalletsTopology, load_config, save_config


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
