"""Tests for the agent-wallet CLI."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest
from typer.testing import CliRunner

import agent_wallet.delivery.cli as cli_module
from agent_wallet.delivery.cli import app

runner = CliRunner()

TEST_PASSWORD = "Test-password-123!"
TEST_PRIVATE_KEY = (
    "4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b"
)
TEST_MNEMONIC = "test test test test test test test test test test test junk"

# Minimal EIP-1559 tx for `sign tx` CLI (eth_account-compatible).
MINIMAL_SIGN_TX = {
    "to": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "value": 0,
    "gas": 21000,
    "maxFeePerGas": 20000000000,
    "maxPriorityFeePerGas": 1000000000,
    "nonce": 0,
    "chainId": 1,
    "type": 2,
}

# Minimal valid EIP-712 payload for `sign typed-data` CLI.
MINIMAL_TYPED_DATA = {
    "types": {
        "EIP712Domain": [
            {"name": "name", "type": "string"},
            {"name": "chainId", "type": "uint256"},
            {"name": "verifyingContract", "type": "address"},
        ],
        "Message": [{"name": "content", "type": "string"}],
    },
    "primaryType": "Message",
    "domain": {
        "name": "CLI-Test",
        "chainId": 1,
        "verifyingContract": "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
    },
    "message": {"content": "hello"},
}


def _read_config(secrets_dir: str) -> dict:
    return json.loads((Path(secrets_dir) / "wallets_config.json").read_text())


@pytest.fixture
def secrets_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture(autouse=True)
def force_tty(monkeypatch):
    monkeypatch.setattr(cli_module, "_require_interactive", lambda _action: None)


@pytest.fixture
def initialized_dir(secrets_dir):
    result = runner.invoke(
        app,
        ["init", "--dir", secrets_dir],
        input=f"{TEST_PASSWORD}\n{TEST_PASSWORD}\n",
    )
    assert result.exit_code == 0
    return secrets_dir


class TestInit:
    def test_init_creates_files(self, secrets_dir):
        result = runner.invoke(
            app,
            ["init", "--dir", secrets_dir],
            input=f"{TEST_PASSWORD}\n{TEST_PASSWORD}\n",
        )
        assert result.exit_code == 0
        assert "Initialized" in result.output
        assert "Password requirements:" in result.output
        assert (Path(secrets_dir) / "master.json").exists()
        assert (Path(secrets_dir) / "wallets_config.json").exists()

    def test_init_with_invalid_runtime_secrets_fails_cleanly(self, secrets_dir):
        (Path(secrets_dir) / "runtime_secrets.json").write_text('["bad"]\n', encoding="utf-8")
        result = runner.invoke(app, ["init", "--dir", secrets_dir])
        assert result.exit_code == 1
        assert "Invalid runtime secrets" in result.output

    def test_init_fails_when_already_initialized(self, secrets_dir):
        first = runner.invoke(
            app,
            ["init", "--dir", secrets_dir],
            input=f"{TEST_PASSWORD}\n{TEST_PASSWORD}\n",
        )
        assert first.exit_code == 0
        second = runner.invoke(
            app,
            ["init", "--dir", secrets_dir],
            input=f"{TEST_PASSWORD}\n{TEST_PASSWORD}\n",
        )
        assert second.exit_code == 1
        assert "Already initialized" in second.output


class TestAdd:
    def test_add_prompts_for_wallet_type_when_missing(self, initialized_dir):
        result = runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"raw_secret\nwallet\nprivate_key\n{TEST_PRIVATE_KEY}\n",
        )
        assert result.exit_code == 0
        config = _read_config(initialized_dir)
        assert config["wallets"]["wallet"]["type"] == "raw_secret"

    def test_add_local_secure_generate_shortcut(self, initialized_dir):
        result = runner.invoke(
            app,
            ["add", "local_secure", "--wallet-id", "my_key", "--generate", "--dir", initialized_dir],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 0
        config = _read_config(initialized_dir)
        assert config["wallets"]["my_key"]["type"] == "local_secure"
        assert (Path(initialized_dir) / "secret_my_key.json").exists()

    def test_add_local_secure_generate(self, initialized_dir):
        result = runner.invoke(
            app,
            ["add", "local_secure", "--dir", initialized_dir],
            input="my_key\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 0
        assert "added" in result.output
        config = _read_config(initialized_dir)
        assert config["wallets"]["my_key"]["type"] == "local_secure"
        assert config["wallets"]["my_key"]["params"]["secret_ref"] == "my_key"
        assert (Path(initialized_dir) / "secret_my_key.json").exists()

    def test_add_uses_wallet_type_default_id_when_prompt_is_empty(self, initialized_dir):
        result = runner.invoke(
            app,
            ["add", "raw_secret", "--dir", initialized_dir],
            input=f"\nprivate_key\n{TEST_PRIVATE_KEY}\n",
        )
        assert result.exit_code == 0
        config = _read_config(initialized_dir)
        assert config["wallets"]["default_raw"]["type"] == "raw_secret"

    def test_add_local_secure_import(self, initialized_dir):
        result = runner.invoke(
            app,
            ["add", "local_secure", "--dir", initialized_dir],
            input=f"imported\nprivate_key\n{TEST_PRIVATE_KEY}\n",
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 0
        assert "Imported secret material" in result.output
        assert (Path(initialized_dir) / "secret_imported.json").exists()

    def test_add_local_secure_prompts_for_existing_password_before_wallet_id(self, initialized_dir):
        result = runner.invoke(
            app,
            ["add", "local_secure", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nordered_wallet\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        assert result.exit_code == 0
        assert (Path(initialized_dir) / "secret_ordered_wallet.json").exists()

    def test_add_local_secure_mnemonic_shortcut_with_derive_as(self, initialized_dir):
        result = runner.invoke(
            app,
            [
                "add",
                "local_secure",
                "--wallet-id",
                "seed_key",
                "--mnemonic",
                TEST_MNEMONIC,
                "--mnemonic-index",
                "1",
                "--derive-as",
                "eip155",
                "--dir",
                initialized_dir,
            ],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 0
        assert (Path(initialized_dir) / "secret_seed_key.json").exists()

    def test_add_raw_secret_private_key_wallet(self, initialized_dir):
        result = runner.invoke(
            app,
            ["add", "raw_secret", "--dir", initialized_dir],
            input=f"hot_key\nprivate_key\n{TEST_PRIVATE_KEY}\n",
        )
        assert result.exit_code == 0
        config = _read_config(initialized_dir)
        assert config["wallets"]["hot_key"]["type"] == "raw_secret"
        assert config["wallets"]["hot_key"]["params"]["source"] == "private_key"

    def test_add_raw_secret_mnemonic_wallet(self, initialized_dir):
        result = runner.invoke(
            app,
            ["add", "raw_secret", "--dir", initialized_dir],
            input=f"seed_key\nmnemonic\n{TEST_MNEMONIC}\n1\ntron\n",
        )
        assert result.exit_code == 0
        config = _read_config(initialized_dir)
        assert config["wallets"]["seed_key"]["type"] == "raw_secret"
        assert config["wallets"]["seed_key"]["params"]["source"] == "mnemonic"
        assert config["wallets"]["seed_key"]["params"]["account_index"] == 1

    def test_add_raw_secret_mnemonic_wallet_supports_derive_as_flag(self, initialized_dir):
        result = runner.invoke(
            app,
            [
                "add",
                "raw_secret",
                "--wallet-id",
                "seed_key",
                "--mnemonic",
                TEST_MNEMONIC,
                "--mnemonic-index",
                "1",
                "--derive-as",
                "tron",
                "--dir",
                initialized_dir,
            ],
        )
        assert result.exit_code == 0
        config = _read_config(initialized_dir)
        assert config["wallets"]["seed_key"]["params"]["source"] == "mnemonic"
        assert config["wallets"]["seed_key"]["params"]["account_index"] == 1

    def test_add_conflicting_generate_and_private_key(self, initialized_dir):
        result = runner.invoke(
            app,
            [
                "add",
                "local_secure",
                "--wallet-id",
                "x",
                "--generate",
                "--private-key",
                TEST_PRIVATE_KEY,
                "--dir",
                initialized_dir,
            ],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 1
        assert "only one of --generate" in result.output


class TestListAndInspect:
    def test_list_with_wallets(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "local_secure", "--dir", initialized_dir],
            input="test_wallet\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        result = runner.invoke(app, ["list", "--dir", initialized_dir])
        assert result.exit_code == 0
        assert "test_wallet" in result.output
        assert "local_secure" in result.output

    def test_inspect_local_secure_wallet(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "local_secure", "--dir", initialized_dir],
            input="inspect_me\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        result = runner.invoke(app, ["inspect", "inspect_me", "--dir", initialized_dir])
        assert result.exit_code == 0
        assert "inspect_me" in result.output
        assert "Secret" in result.output
        assert "secret_inspect_me.json" in result.output

    def test_inspect_missing_wallet(self, initialized_dir):
        result = runner.invoke(app, ["inspect", "missing", "--dir", initialized_dir])
        assert result.exit_code == 1
        assert "not found" in result.output


class TestRemove:
    def test_remove_local_secure_wallet(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "local_secure", "--dir", initialized_dir],
            input="remove_me\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert (Path(initialized_dir) / "secret_remove_me.json").exists()

        result = runner.invoke(
            app,
            ["remove", "remove_me", "--dir", initialized_dir, "--yes"],
        )
        assert result.exit_code == 0
        assert not (Path(initialized_dir) / "secret_remove_me.json").exists()

    def test_remove_missing_wallet(self, initialized_dir):
        result = runner.invoke(
            app,
            ["remove", "missing", "--dir", initialized_dir, "--yes"],
        )
        assert result.exit_code == 1
        assert "not found" in result.output


class TestSign:
    @pytest.fixture
    def dir_with_local_secure_wallet(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "local_secure", "--dir", initialized_dir],
            input="sign_wallet\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        return initialized_dir

    def test_sign_message(self, dir_with_local_secure_wallet):
        result = runner.invoke(
            app,
            [
                "sign",
                "msg",
                "hello world",
                "--wallet-id",
                "sign_wallet",
                "--network",
                "eip155",
                "--dir",
                dir_with_local_secure_wallet,
            ],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 0
        assert "Signature:" in result.output

    def test_sign_message_requires_network(self, dir_with_local_secure_wallet):
        result = runner.invoke(
            app,
            [
                "sign",
                "msg",
                "hello world",
                "--wallet-id",
                "sign_wallet",
                "--dir",
                dir_with_local_secure_wallet,
            ],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code != 0

    def test_sign_private_key_wallet_without_password(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "raw_secret", "--dir", initialized_dir],
            input=f"hot_wallet\nprivate_key\n{TEST_PRIVATE_KEY}\n",
        )
        result = runner.invoke(
            app,
            [
                "sign",
                "msg",
                "hello",
                "--wallet-id",
                "hot_wallet",
                "--network",
                "eip155",
                "--dir",
                initialized_dir,
            ],
        )
        assert result.exit_code == 0

    def test_sign_tx_success(self, dir_with_local_secure_wallet):
        payload = json.dumps(MINIMAL_SIGN_TX)
        result = runner.invoke(
            app,
            [
                "sign",
                "tx",
                payload,
                "--wallet-id",
                "sign_wallet",
                "--network",
                "eip155:1",
                "--dir",
                dir_with_local_secure_wallet,
            ],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 0
        assert "Signed tx" in result.output

    def test_sign_tx_invalid_json(self, dir_with_local_secure_wallet):
        result = runner.invoke(
            app,
            [
                "sign",
                "tx",
                "not-valid-json{{{",
                "--wallet-id",
                "sign_wallet",
                "--network",
                "eip155",
                "--dir",
                dir_with_local_secure_wallet,
            ],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 1
        assert "Error" in result.output

    def test_sign_typed_data_success(self, dir_with_local_secure_wallet):
        payload = json.dumps(MINIMAL_TYPED_DATA)
        result = runner.invoke(
            app,
            [
                "sign",
                "typed-data",
                payload,
                "--wallet-id",
                "sign_wallet",
                "--network",
                "eip155:1",
                "--dir",
                dir_with_local_secure_wallet,
            ],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 0
        assert "Signature:" in result.output

    def test_sign_typed_data_invalid_json(self, dir_with_local_secure_wallet):
        result = runner.invoke(
            app,
            [
                "sign",
                "typed-data",
                "{",
                "--wallet-id",
                "sign_wallet",
                "--network",
                "eip155",
                "--dir",
                dir_with_local_secure_wallet,
            ],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 1

    def test_sign_typed_data_not_eip712_structure(self, dir_with_local_secure_wallet):
        result = runner.invoke(
            app,
            [
                "sign",
                "typed-data",
                '{"only": "object"}',
                "--wallet-id",
                "sign_wallet",
                "--network",
                "eip155:1",
                "--dir",
                dir_with_local_secure_wallet,
            ],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 1
        assert "Error" in result.output

    def test_sign_message_tron_network(self, dir_with_local_secure_wallet):
        result = runner.invoke(
            app,
            [
                "sign",
                "msg",
                "tron hello",
                "--wallet-id",
                "sign_wallet",
                "--network",
                "tron:nile",
                "--dir",
                dir_with_local_secure_wallet,
            ],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 0
        assert "Signature:" in result.output

    def test_sign_local_secure_without_password_exits_cleanly(self, dir_with_local_secure_wallet):
        result = runner.invoke(
            app,
            [
                "sign",
                "msg",
                "hello",
                "--wallet-id",
                "sign_wallet",
                "--network",
                "eip155",
                "--dir",
                dir_with_local_secure_wallet,
            ],
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        assert result.exit_code == 1
        assert "Traceback" not in result.output

    def test_sign_with_invalid_runtime_secrets_exits_cleanly(self, dir_with_local_secure_wallet):
        (Path(dir_with_local_secure_wallet) / "runtime_secrets.json").write_text(
            '["bad"]\n', encoding="utf-8"
        )
        result = runner.invoke(
            app,
            [
                "sign",
                "msg",
                "hello",
                "--wallet-id",
                "sign_wallet",
                "--network",
                "eip155",
                "--dir",
                dir_with_local_secure_wallet,
            ],
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        assert result.exit_code == 1
        assert "Invalid runtime secrets" in result.output


class TestChangePassword:
    def test_change_password(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "local_secure", "--dir", initialized_dir],
            input="pw_wallet\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )

        new_pw = "New-password-456!"
        result = runner.invoke(
            app,
            ["change-password", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\n{new_pw}\n{new_pw}\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        assert result.exit_code == 0

        result_sign = runner.invoke(
            app,
            [
                "sign",
                "msg",
                "hello",
                "--wallet-id",
                "pw_wallet",
                "--network",
                "eip155",
                "--dir",
                initialized_dir,
            ],
            env={"AGENT_WALLET_PASSWORD": new_pw},
        )
        assert result_sign.exit_code == 0

    def test_change_password_updates_existing_runtime_secrets(self, initialized_dir):
        runtime_path = Path(initialized_dir) / "runtime_secrets.json"
        runtime_path.write_text(json.dumps({"password": TEST_PASSWORD}) + "\n", encoding="utf-8")

        new_pw = "New-password-456!"
        result = runner.invoke(
            app,
            ["change-password", "--dir", initialized_dir],
            input=f"{new_pw}\n{new_pw}\n",
        )
        assert result.exit_code == 0
        assert json.loads(runtime_path.read_text())["password"] == new_pw


class TestStart:
    def test_start_unknown_wallet_type_fails(self, secrets_dir):
        result = runner.invoke(app, ["start", "unknown", "--dir", secrets_dir])
        assert result.exit_code == 1
        assert "Unknown wallet type" in result.output

    def test_start_conflicting_generate_and_private_key(self, secrets_dir):
        result = runner.invoke(
            app,
            [
                "start",
                "local_secure",
                "-p",
                TEST_PASSWORD,
                "--wallet-id",
                "x",
                "--generate",
                "--private-key",
                TEST_PRIVATE_KEY,
                "--dir",
                secrets_dir,
            ],
        )
        assert result.exit_code == 1
        assert "only one of --generate" in result.output

    def test_start_local_secure_with_password_creates_default_wallet(self, secrets_dir):
        result = runner.invoke(
            app,
            [
                "start",
                "local_secure",
                "-p",
                TEST_PASSWORD,
                "--dir",
                secrets_dir,
            ],
            input="\ngenerate\n",
        )
        assert result.exit_code == 0
        assert "default_secure" in result.output
        config = _read_config(secrets_dir)
        assert config["wallets"]["default_secure"]["type"] == "local_secure"
        assert config["wallets"]["default_secure"]["params"]["secret_ref"] == "default_secure"

    def test_start_local_secure_generate_shortcut(self, secrets_dir):
        result = runner.invoke(
            app,
            [
                "start",
                "local_secure",
                "-p",
                TEST_PASSWORD,
                "--wallet-id",
                "shortcut",
                "--generate",
                "--dir",
                secrets_dir,
            ],
        )
        assert result.exit_code == 0
        config = _read_config(secrets_dir)
        assert config["wallets"]["shortcut"]["type"] == "local_secure"
        assert config["wallets"]["shortcut"]["params"]["secret_ref"] == "shortcut"
        assert config["active_wallet"] == "shortcut"

    def test_start_local_secure_uses_manual_password_when_prompt_is_filled(self, secrets_dir):
        result = runner.invoke(
            app,
            [
                "start",
                "local_secure",
                "--wallet-id",
                "manual",
                "--dir",
                secrets_dir,
            ],
            input=f"{TEST_PASSWORD}\n{TEST_PASSWORD}\ngenerate\n",
        )
        assert result.exit_code == 0
        config = _read_config(secrets_dir)
        assert config["wallets"]["manual"]["type"] == "local_secure"
        assert "Your master password:" not in result.output

    def test_start_local_secure_auto_generates_when_password_prompt_is_empty(self, secrets_dir):
        result = runner.invoke(
            app,
            [
                "start",
                "local_secure",
                "--wallet-id",
                "auto",
                "--dir",
                secrets_dir,
            ],
            input="\ngenerate\n",
        )
        assert result.exit_code == 0
        config = _read_config(secrets_dir)
        assert config["wallets"]["auto"]["type"] == "local_secure"
        assert "Your master password:" in result.output
        assert "Keep this password safe." in result.output

    def test_start_local_secure_mnemonic_shortcut_with_derive_as(self, secrets_dir):
        result = runner.invoke(
            app,
            [
                "start",
                "local_secure",
                "-p",
                TEST_PASSWORD,
                "--wallet-id",
                "seed",
                "--mnemonic",
                TEST_MNEMONIC,
                "--mnemonic-index",
                "1",
                "--derive-as",
                "eip155",
                "--dir",
                secrets_dir,
            ],
        )
        assert result.exit_code == 0
        assert (Path(secrets_dir) / "secret_seed.json").exists()

    def test_start_raw_secret_private_key_wallet(self, secrets_dir):
        result = runner.invoke(
            app,
            ["start", "raw_secret", "--wallet-id", "hot_wallet", "--dir", secrets_dir],
            input=f"private_key\n{TEST_PRIVATE_KEY}\n",
        )
        assert result.exit_code == 0
        config = _read_config(secrets_dir)
        assert config["wallets"]["hot_wallet"]["type"] == "raw_secret"
        assert config["wallets"]["hot_wallet"]["params"]["source"] == "private_key"
        assert config["active_wallet"] == "hot_wallet"

    def test_start_raw_secret_mnemonic_wallet_prompts_for_derivation_profile(self, secrets_dir):
        result = runner.invoke(
            app,
            ["start", "raw_secret", "--wallet-id", "hot_wallet", "--dir", secrets_dir],
            input=f"mnemonic\n{TEST_MNEMONIC}\n1\ntron\n",
        )
        assert result.exit_code == 0
        config = _read_config(secrets_dir)
        assert config["wallets"]["hot_wallet"]["params"]["source"] == "mnemonic"
        assert config["wallets"]["hot_wallet"]["params"]["account_index"] == 1

    def test_start_created_wallet_becomes_active_even_when_active_exists(self, secrets_dir):
        first = runner.invoke(
            app,
            [
                "start",
                "raw_secret",
                "--wallet-id",
                "w1",
                "--dir",
                secrets_dir,
            ],
            input=f"private_key\n{TEST_PRIVATE_KEY}\n",
        )
        assert first.exit_code == 0

        second = runner.invoke(
            app,
            [
                "start",
                "raw_secret",
                "--wallet-id",
                "w2",
                "--override",
                "--dir",
                secrets_dir,
            ],
            input=f"private_key\n{TEST_PRIVATE_KEY}\n",
        )
        assert second.exit_code == 0
        assert _read_config(secrets_dir)["active_wallet"] == "w2"

    def test_start_raw_secret_invalid_hex(self, secrets_dir):
        result = runner.invoke(
            app,
            ["start", "raw_secret", "--wallet-id", "hot_wallet", "--dir", secrets_dir],
            input="private_key\nnot-hex\n",
        )
        assert result.exit_code == 1
        assert "Private key must be 32 bytes" in result.output

    def test_start_raw_secret_invalid_length(self, secrets_dir):
        result = runner.invoke(
            app,
            ["start", "raw_secret", "--wallet-id", "hot_wallet", "--dir", secrets_dir],
            input="private_key\n1234\n",
        )
        assert result.exit_code == 1
        assert "Private key must be 32 bytes" in result.output

    def test_start_with_legacy_config_fails_cleanly(self, secrets_dir):
        (Path(secrets_dir) / "wallets_config.json").write_text(
            json.dumps(
                {
                    "active_wallet": "default_tron",
                    "wallets": {
                        "default_tron": {
                            "type": "tron_local",
                            "identity_file": "default_tron",
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        result = runner.invoke(
            app,
            ["start", "local_secure", "--dir", secrets_dir],
            input="default\n",
        )
        assert result.exit_code == 1
        assert "Invalid wallet config" in result.output
        assert "unsupported or stale schema" in result.output


    def test_start_exits_when_wallets_exist_and_user_selects_exit(self, secrets_dir):
        """start should prompt and exit when wallets already exist and user picks exit."""
        runner.invoke(
            app,
            ["start", "raw_secret", "--wallet-id", "w1", "--dir", secrets_dir],
            input=f"private_key\n{TEST_PRIVATE_KEY}\n",
        )
        result = runner.invoke(
            app,
            ["start", "--dir", secrets_dir],
            input="exit\n",
        )
        assert result.exit_code == 0
        assert "Already initialized" in result.output

    def test_start_continues_when_wallets_exist_and_user_selects_add(self, secrets_dir):
        """start should continue normally when wallets exist and user picks add."""
        runner.invoke(
            app,
            ["start", "raw_secret", "--wallet-id", "w1", "--dir", secrets_dir],
            input=f"private_key\n{TEST_PRIVATE_KEY}\n",
        )
        result = runner.invoke(
            app,
            ["start", "raw_secret", "--wallet-id", "w2", "--override", "--dir", secrets_dir],
            input=f"private_key\n{TEST_PRIVATE_KEY}\n",
        )
        assert result.exit_code == 0
        config = _read_config(secrets_dir)
        assert "w2" in config["wallets"]

    def test_start_override_skips_prompt(self, secrets_dir):
        """--override should skip the 'already initialized' prompt entirely."""
        runner.invoke(
            app,
            ["start", "raw_secret", "--wallet-id", "w1", "--dir", secrets_dir],
            input=f"private_key\n{TEST_PRIVATE_KEY}\n",
        )
        result = runner.invoke(
            app,
            ["start", "raw_secret", "--wallet-id", "w2", "--override", "--dir", secrets_dir],
            input=f"private_key\n{TEST_PRIVATE_KEY}\n",
        )
        assert result.exit_code == 0
        assert "Already initialized" not in result.output

    def test_start_no_prompt_on_fresh_dir(self, secrets_dir):
        """start should not prompt on a fresh directory with no wallets."""
        result = runner.invoke(
            app,
            ["start", "raw_secret", "--wallet-id", "w1", "--dir", secrets_dir],
            input=f"private_key\n{TEST_PRIVATE_KEY}\n",
        )
        assert result.exit_code == 0
        assert "Already initialized" not in result.output


    def test_start_explicit_wallet_id_duplicate_errors(self, secrets_dir):
        """--wallet-id with a duplicate should error immediately, not re-prompt."""
        runner.invoke(
            app,
            ["start", "raw_secret", "--wallet-id", "w1", "--dir", secrets_dir],
            input=f"private_key\n{TEST_PRIVATE_KEY}\n",
        )
        result = runner.invoke(
            app,
            ["start", "raw_secret", "--wallet-id", "w1", "--override", "--dir", secrets_dir],
            input=f"private_key\n{TEST_PRIVATE_KEY}\n",
        )
        assert result.exit_code == 1
        assert "already exists" in result.output

    def test_start_wrong_password_retries_interactively(self, secrets_dir):
        """Interactive wrong password should allow retry, not exit immediately."""
        # Init with known password
        first = runner.invoke(
            app,
            ["start", "local_secure", "-w", "default", "-g", "--dir", secrets_dir, "-p", TEST_PASSWORD],
        )
        assert first.exit_code == 0
        # Second start: wrong password, then correct password
        result = runner.invoke(
            app,
            ["start", "local_secure", "-w", "w2", "--override", "-g", "--dir", secrets_dir],
            input=f"bad_password\n{TEST_PASSWORD}\n",
        )
        assert result.exit_code == 0
        assert "Wrong password" in result.output

    def test_start_wrong_password_explicit_flag_exits(self, secrets_dir):
        """-p with wrong password should error immediately, no retry."""
        first = runner.invoke(
            app,
            ["start", "local_secure", "-w", "default", "-g", "--dir", secrets_dir, "-p", TEST_PASSWORD],
        )
        assert first.exit_code == 0
        result = runner.invoke(
            app,
            ["start", "local_secure", "-w", "w2", "--override", "-g", "--dir", secrets_dir, "-p", "wrong"],
        )
        assert result.exit_code == 1
        assert "Wrong password" in result.output

    def test_add_explicit_wallet_id_duplicate_errors(self, initialized_dir):
        """add --wallet-id with duplicate should error, not re-prompt."""
        runner.invoke(
            app,
            ["add", "local_secure", "-w", "w1", "-g", "--dir", initialized_dir],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        result = runner.invoke(
            app,
            ["add", "local_secure", "-w", "w1", "-g", "--dir", initialized_dir],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 1
        assert "already exists" in result.output


class TestActiveWallet:
    def test_use_command_sets_active(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "local_secure", "--dir", initialized_dir],
            input="w1\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        runner.invoke(
            app,
            ["add", "raw_secret", "--dir", initialized_dir],
            input=f"w2\nprivate_key\n{TEST_PRIVATE_KEY}\n",
        )
        result = runner.invoke(app, ["use", "w2", "--dir", initialized_dir])
        assert result.exit_code == 0
        assert _read_config(initialized_dir)["active_wallet"] == "w2"

    def test_use_command_prompts_to_select_wallet_when_missing(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "local_secure", "--dir", initialized_dir],
            input="w1\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        runner.invoke(
            app,
            ["add", "raw_secret", "--dir", initialized_dir],
            input=f"w2\nprivate_key\n{TEST_PRIVATE_KEY}\n",
        )
        result = runner.invoke(app, ["use", "--dir", initialized_dir], input="w2\n")
        assert result.exit_code == 0
        assert _read_config(initialized_dir)["active_wallet"] == "w2"

    def test_use_missing_wallet_fails(self, initialized_dir):
        result = runner.invoke(app, ["use", "missing", "--dir", initialized_dir])
        assert result.exit_code == 1
        assert "not found" in result.output

    def test_sign_without_wallet_uses_active(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "local_secure", "--dir", initialized_dir],
            input="active_signer\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        result = runner.invoke(
            app,
            ["sign", "msg", "hello active", "--network", "eip155", "--dir", initialized_dir],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 0


class TestReset:
    def test_reset_with_yes(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "local_secure", "--dir", initialized_dir],
            input="w1\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )

        p = Path(initialized_dir)
        assert (p / "master.json").exists()
        assert (p / "wallets_config.json").exists()
        assert (p / "secret_w1.json").exists()

        result = runner.invoke(app, ["reset", "--dir", initialized_dir, "--yes"])
        assert result.exit_code == 0
        assert not (p / "secret_w1.json").exists()

    def test_reset_only_deletes_managed_files(self, initialized_dir):
        p = Path(initialized_dir)
        runner.invoke(
            app,
            ["add", "local_secure", "--dir", initialized_dir, "--save-runtime-secrets"],
            input="w1\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        (p / "custom.json").write_text('{"keep": true}\n', encoding="utf-8")

        result = runner.invoke(app, ["reset", "--dir", initialized_dir, "--yes"])
        assert result.exit_code == 0
        assert not (p / "master.json").exists()
        assert not (p / "wallets_config.json").exists()
        assert not (p / "runtime_secrets.json").exists()
        assert not (p / "secret_w1.json").exists()
        assert (p / "custom.json").exists()

    def test_reset_works_for_raw_secret_only_directory(self, secrets_dir):
        p = Path(secrets_dir)
        start = runner.invoke(
            app,
            ["start", "raw_secret", "--wallet-id", "raw_wallet", "--dir", secrets_dir],
            input=f"private_key\n{TEST_PRIVATE_KEY}\n",
        )
        assert start.exit_code == 0
        assert not (p / "master.json").exists()
        assert (p / "wallets_config.json").exists()

        result = runner.invoke(app, ["reset", "--dir", secrets_dir, "--yes"])
        assert result.exit_code == 0
        assert not (p / "wallets_config.json").exists()
