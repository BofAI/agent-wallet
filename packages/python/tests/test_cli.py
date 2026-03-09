"""Tests for the agent-wallet CLI."""

import json
import os
import tempfile

import pytest
from typer.testing import CliRunner

from agent_wallet.delivery.cli import app

runner = CliRunner()

TEST_PASSWORD = "Test-password-123!"


@pytest.fixture
def secrets_dir():
    """Create a temp directory for secrets."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def initialized_dir(secrets_dir):
    """Create an initialized secrets directory."""
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
        assert (pathlib.Path(secrets_dir) / "master.json").exists()
        assert (pathlib.Path(secrets_dir) / "wallets_config.json").exists()

    def test_init_already_initialized(self, initialized_dir):
        result = runner.invoke(
            app,
            ["init", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\n{TEST_PASSWORD}\n",
        )
        assert result.exit_code == 1
        assert "Already initialized" in result.output

    def test_init_password_mismatch(self, secrets_dir):
        result = runner.invoke(
            app,
            ["init", "--dir", secrets_dir],
            input="Strong-pass-1!\nStrong-pass-2!\n",
        )
        assert result.exit_code == 1
        assert "do not match" in result.output


class TestAdd:
    def test_add_evm_generate(self, initialized_dir):
        result = runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nmy_evm\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        assert result.exit_code == 0
        assert "added" in result.output
        assert "0x" in result.output  # EVM address

        # Verify config updated
        config_path = pathlib.Path(initialized_dir) / "wallets_config.json"
        config = json.loads(config_path.read_text())
        assert "my_evm" in config["wallets"]
        assert config["wallets"]["my_evm"]["type"] == "evm_local"

    def test_add_tron_generate(self, initialized_dir):
        result = runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nmy_tron\ntron_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        assert result.exit_code == 0
        assert "added" in result.output
        assert "T" in result.output  # Tron address starts with T

    def test_add_evm_import(self, initialized_dir):
        test_key = "4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b"
        result = runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nimported_evm\nevm_local\nimport\n{test_key}\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        assert result.exit_code == 0
        assert "Imported" in result.output

    def test_add_duplicate_name(self, initialized_dir):
        # Add first
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\ndup_wallet\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        # Add duplicate
        result = runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\ndup_wallet\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        assert result.exit_code == 1
        assert "already exists" in result.output


class TestList:
    def test_list_empty(self, initialized_dir):
        result = runner.invoke(app, ["list", "--dir", initialized_dir])
        assert result.exit_code == 0
        assert "No wallets" in result.output

    def test_list_with_wallets(self, initialized_dir):
        # Add a wallet first
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\ntest_wallet\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        result = runner.invoke(app, ["list", "--dir", initialized_dir])
        assert result.exit_code == 0
        assert "test_wallet" in result.output
        assert "evm_local" in result.output


class TestInspect:
    def test_inspect_wallet(self, initialized_dir):
        # Add a wallet
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\ninspect_me\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        result = runner.invoke(
            app,
            ["inspect", "inspect_me", "--dir", initialized_dir],
        )
        assert result.exit_code == 0
        assert "inspect_me" in result.output
        assert "0x" in result.output

    def test_inspect_not_found(self, initialized_dir):
        result = runner.invoke(
            app,
            ["inspect", "nonexistent", "--dir", initialized_dir],
        )
        assert result.exit_code == 1
        assert "not found" in result.output


class TestRemove:
    def test_remove_wallet(self, initialized_dir):
        # Add a wallet
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nremove_me\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )

        # Verify file exists
        assert (pathlib.Path(initialized_dir) / "id_remove_me.json").exists()

        # Remove with --yes
        result = runner.invoke(
            app,
            ["remove", "remove_me", "--dir", initialized_dir, "--yes"],
        )
        assert result.exit_code == 0
        assert "removed" in result.output

        # Verify file deleted
        assert not (pathlib.Path(initialized_dir) / "id_remove_me.json").exists()

        # Verify config updated
        config = json.loads(
            (pathlib.Path(initialized_dir) / "wallets_config.json").read_text()
        )
        assert "remove_me" not in config["wallets"]

    def test_remove_not_found(self, initialized_dir):
        result = runner.invoke(
            app,
            ["remove", "nonexistent", "--dir", initialized_dir, "--yes"],
        )
        assert result.exit_code == 1
        assert "not found" in result.output


class TestSign:
    @pytest.fixture
    def dir_with_evm_wallet(self, initialized_dir):
        """Create a dir with an EVM wallet for signing tests."""
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nsign_wallet\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        return initialized_dir

    def test_sign_message(self, dir_with_evm_wallet):
        result = runner.invoke(
            app,
            [
                "sign", "msg",
                "--wallet", "sign_wallet",
                "--message", "hello world",
                "--dir", dir_with_evm_wallet,
            ],
            input=f"{TEST_PASSWORD}\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        assert result.exit_code == 0
        assert "Signature:" in result.output

    def test_sign_message_with_env_password(self, dir_with_evm_wallet):
        result = runner.invoke(
            app,
            [
                "sign", "msg",
                "--wallet", "sign_wallet",
                "--message", "hello",
                "--dir", dir_with_evm_wallet,
            ],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 0
        assert "Signature:" in result.output

    def test_sign_wallet_not_found(self, dir_with_evm_wallet):
        result = runner.invoke(
            app,
            [
                "sign", "msg",
                "--wallet", "nonexistent",
                "--message", "hello",
                "--dir", dir_with_evm_wallet,
            ],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 1
        assert "Error" in result.output


class TestChangePassword:
    def test_change_password(self, initialized_dir):
        # Add a wallet
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\npw_wallet\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )

        # Change password
        new_pw = "New-password-456!"
        result = runner.invoke(
            app,
            ["change-password", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\n{new_pw}\n{new_pw}\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        assert result.exit_code == 0
        assert "Password changed" in result.output
        assert "master.json" in result.output

        # Verify new password works
        result_after = runner.invoke(
            app,
            ["list", "--dir", initialized_dir],
        )
        assert result_after.exit_code == 0
        assert "pw_wallet" in result_after.output

        # Verify wallet still accessible (inspect no longer needs password)
        result_inspect = runner.invoke(
            app,
            ["inspect", "pw_wallet", "--dir", initialized_dir],
        )
        assert result_inspect.exit_code == 0
        assert "0x" in result_inspect.output


import pathlib


class TestWeakPassword:
    def test_init_rejects_weak_password_too_short(self, secrets_dir):
        result = runner.invoke(
            app,
            ["init", "--dir", secrets_dir],
            input="Ab1!\nAb1!\n",
        )
        assert result.exit_code == 1
        assert "Password too weak" in result.output
        assert "at least 8 characters" in result.output

    def test_init_rejects_password_without_uppercase(self, secrets_dir):
        result = runner.invoke(
            app,
            ["init", "--dir", secrets_dir],
            input="test-password-1!\ntest-password-1!\n",
        )
        assert result.exit_code == 1
        assert "at least 1 uppercase letter" in result.output

    def test_init_rejects_password_without_special_char(self, secrets_dir):
        result = runner.invoke(
            app,
            ["init", "--dir", secrets_dir],
            input="TestPassword1\nTestPassword1\n",
        )
        assert result.exit_code == 1
        assert "at least 1 special character" in result.output

    def test_change_password_rejects_weak_new_password(self, initialized_dir):
        # Add a wallet
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nw1\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        # Change password with weak new pw
        result = runner.invoke(
            app,
            ["change-password", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nweak\nweak\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        assert result.exit_code == 1
        assert "Password too weak" in result.output


class TestActiveWallet:
    def test_first_add_auto_sets_active(self, initialized_dir):
        result = runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nfirst_wallet\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        assert result.exit_code == 0
        assert "Active wallet set to 'first_wallet'" in result.output

        config = json.loads(
            (pathlib.Path(initialized_dir) / "wallets_config.json").read_text()
        )
        assert config["active_wallet"] == "first_wallet"

    def test_second_add_does_not_change_active(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nw1\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nw2\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        config = json.loads(
            (pathlib.Path(initialized_dir) / "wallets_config.json").read_text()
        )
        assert config["active_wallet"] == "w1"

    def test_use_command_sets_active(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nw1\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nw2\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        result = runner.invoke(app, ["use", "w2", "--dir", initialized_dir])
        assert result.exit_code == 0
        assert "Active wallet: w2" in result.output

        config = json.loads(
            (pathlib.Path(initialized_dir) / "wallets_config.json").read_text()
        )
        assert config["active_wallet"] == "w2"

    def test_use_command_rejects_nonexistent(self, initialized_dir):
        result = runner.invoke(app, ["use", "nonexistent", "--dir", initialized_dir])
        assert result.exit_code == 1
        assert "not found" in result.output

    def test_list_shows_active_marker(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nw1\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nw2\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        result = runner.invoke(app, ["list", "--dir", initialized_dir])
        assert result.exit_code == 0
        assert "*" in result.output  # active marker

    def test_remove_active_wallet_clears_active(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nw1\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        result = runner.invoke(
            app, ["remove", "w1", "--dir", initialized_dir, "--yes"]
        )
        assert result.exit_code == 0

        config = json.loads(
            (pathlib.Path(initialized_dir) / "wallets_config.json").read_text()
        )
        assert config.get("active_wallet") is None

    def test_sign_without_wallet_uses_active(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nactive_signer\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        result = runner.invoke(
            app,
            ["sign", "msg", "--message", "hello active", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        assert result.exit_code == 0
        assert "Signature:" in result.output

    def test_sign_without_wallet_and_no_active_errors(self, initialized_dir):
        runner.invoke(
            app,
            ["add", "--dir", initialized_dir],
            input=f"{TEST_PASSWORD}\nw1\nevm_local\ngenerate\n",
            env={"AGENT_WALLET_PASSWORD": ""},
        )
        # Clear active wallet
        config_path = pathlib.Path(initialized_dir) / "wallets_config.json"
        config = json.loads(config_path.read_text())
        config["active_wallet"] = None
        config_path.write_text(json.dumps(config))

        result = runner.invoke(
            app,
            ["sign", "msg", "--message", "hello", "--dir", initialized_dir],
            env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
        )
        assert result.exit_code == 1
        assert "No wallet specified" in result.output

    def test_sign_on_uninitialized_dir_shows_not_initialized(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            result = runner.invoke(
                app,
                ["sign", "msg", "--message", "hello", "--dir", tmpdir],
                env={"AGENT_WALLET_PASSWORD": TEST_PASSWORD},
            )
            assert result.exit_code == 1
            assert "not initialized" in result.output.lower()
