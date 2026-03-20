"""Tests for storage layer config loading and validation."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from agent_wallet.core.config import (
    LocalSecureWalletConfig,
    RawSecretMnemonicConfig,
    RawSecretWalletConfig,
    WalletsTopology,
    load_config,
    save_config,
)


@pytest.fixture
def secrets_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


class TestWalletConfig:
    def test_local_secure(self):
        conf = WalletsTopology.model_validate(
            {
                "active_wallet": "w1",
                "wallets": {
                    "w1": {
                        "type": "local_secure",
                        "secret_ref": "w1",
                    }
                },
            }
        )
        assert conf.wallets["w1"].type == "local_secure"
        assert conf.wallets["w1"].secret_ref == "w1"

    def test_raw_secret_private_key(self):
        conf = WalletsTopology.model_validate(
            {
                "wallets": {
                    "hot": {
                        "type": "raw_secret",
                        "material": {
                            "source": "private_key",
                            "private_key": "0xabc",
                        },
                    }
                },
            }
        )
        assert conf.wallets["hot"].type == "raw_secret"
        assert conf.wallets["hot"].material.source == "private_key"

    def test_raw_secret_mnemonic(self):
        conf = WalletsTopology.model_validate(
            {
                "wallets": {
                    "seed": {
                        "type": "raw_secret",
                        "material": {
                            "source": "mnemonic",
                            "mnemonic": "word1 word2",
                            "account_index": 2,
                        },
                    }
                },
            }
        )
        assert conf.wallets["seed"].material.source == "mnemonic"
        assert conf.wallets["seed"].material.account_index == 2

    def test_invalid_type(self):
        with pytest.raises(ValueError):
            WalletsTopology.model_validate(
                {
                    "wallets": {
                        "bad": {"type": "solana_local"}
                    },
                }
            )


class TestLoadSaveConfig:
    def test_roundtrip(self, secrets_dir):
        config = WalletsTopology(
            wallets={
                "deployer": LocalSecureWalletConfig(
                    type="local_secure",
                    secret_ref="key_deployer",
                ),
                "manager": RawSecretWalletConfig(
                    type="raw_secret",
                    material=RawSecretMnemonicConfig(
                        source="mnemonic",
                        mnemonic="test test test",
                        account_index=1,
                    ),
                ),
            }
        )
        save_config(secrets_dir, config)
        loaded = load_config(secrets_dir)
        assert set(loaded.wallets.keys()) == {"deployer", "manager"}
        assert loaded.wallets["deployer"].secret_ref == "key_deployer"
        assert loaded.wallets["manager"].material.account_index == 1

    def test_missing_file(self, secrets_dir):
        with pytest.raises(FileNotFoundError):
            load_config(secrets_dir)

    def test_invalid_json(self, secrets_dir):
        (secrets_dir / "wallets_config.json").write_text("not json", encoding="utf-8")
        with pytest.raises(json.JSONDecodeError):
            load_config(secrets_dir)

    def test_save_does_not_stamp_version(self, secrets_dir):
        config = WalletsTopology(wallets={})
        save_config(secrets_dir, config)
        raw = json.loads((secrets_dir / "wallets_config.json").read_text())
        assert "config_version" not in raw

    def test_load_missing_required_fields_raises(self, secrets_dir):
        (secrets_dir / "wallets_config.json").write_text(
            json.dumps({"active_wallet": "foo"}),
            encoding="utf-8",
        )
        with pytest.raises(ValueError):
            load_config(secrets_dir)
