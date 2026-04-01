from __future__ import annotations

import asyncio
import json

import pytest

from agent_wallet.core import resolver
from agent_wallet.core.adapters.evm import EvmSigner
from agent_wallet.core.adapters.tron import TronSigner
from agent_wallet.core.base import Network
from agent_wallet.core.config import (
    RawSecretPrivateKeyParams,
    WalletConfig,
    load_runtime_secrets_password,
)
from agent_wallet.core.errors import SigningError
from agent_wallet.core.utils import keys as key_utils
from agent_wallet.core.utils import network as network_utils

TEST_KEY = bytes.fromhex(
    "4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b"
)


@pytest.mark.asyncio
async def test_evm_sign_raw_wraps_errors(monkeypatch):
    wallet = EvmSigner(TEST_KEY)

    def boom(_raw_tx):
        raise RuntimeError("boom")

    monkeypatch.setattr(wallet._account, "sign_transaction", boom)
    with pytest.raises(SigningError, match="EVM sign_raw failed"):
        await wallet.sign_raw(b"raw")


@pytest.mark.asyncio
async def test_evm_sign_transaction_wraps_errors(monkeypatch):
    wallet = EvmSigner(TEST_KEY)

    def boom(_payload):
        raise RuntimeError("boom")

    monkeypatch.setattr(wallet._account, "sign_transaction", boom)
    with pytest.raises(SigningError, match="EVM sign_transaction failed"):
        await wallet.sign_transaction({"value": 1})


@pytest.mark.asyncio
async def test_evm_sign_message_wraps_errors(monkeypatch):
    wallet = EvmSigner(TEST_KEY)

    def boom(_signable):
        raise RuntimeError("boom")

    monkeypatch.setattr(wallet._account, "sign_message", boom)
    with pytest.raises(SigningError, match="EVM sign_message failed"):
        await wallet.sign_message(b"hello")


@pytest.mark.asyncio
async def test_evm_sign_typed_data_wraps_errors():
    wallet = EvmSigner(TEST_KEY)
    with pytest.raises(SigningError, match="EVM sign_typed_data failed"):
        await wallet.sign_typed_data({"not": "typed-data"})


@pytest.mark.asyncio
async def test_tron_sign_raw_wraps_errors(monkeypatch):
    wallet = TronSigner(TEST_KEY)

    def boom(_raw_tx):
        raise RuntimeError("boom")

    monkeypatch.setattr(wallet._tron_key, "sign_msg", boom)
    with pytest.raises(SigningError, match="Tron sign_raw failed"):
        await wallet.sign_raw(b"raw")


@pytest.mark.asyncio
async def test_tron_sign_transaction_invalid_payload_is_wrapped():
    wallet = TronSigner(TEST_KEY)
    with pytest.raises(SigningError, match="Tron sign_transaction failed"):
        await wallet.sign_transaction({})


@pytest.mark.asyncio
async def test_tron_sign_message_wraps_errors(monkeypatch):
    wallet = TronSigner(TEST_KEY)

    def boom(_msg):
        raise RuntimeError("boom")

    monkeypatch.setattr(wallet._tron_key, "sign_msg", boom)
    with pytest.raises(SigningError, match="Tron sign_message failed"):
        await wallet.sign_message(b"hello")


@pytest.mark.asyncio
async def test_tron_sign_typed_data_wraps_errors():
    wallet = TronSigner(TEST_KEY)
    with pytest.raises(SigningError, match="Tron sign_typed_data failed"):
        await wallet.sign_typed_data({"not": "typed-data"})


def test_config_provider_private_key_validation_errors():
    with pytest.raises(ValueError, match="64 hex characters"):
        key_utils.decode_private_key("0x1234")

    with pytest.raises(ValueError, match="valid hex string"):
        key_utils.decode_private_key("z" * 64)


def test_config_provider_network_validation_errors():
    with pytest.raises(ValueError, match="network must start with"):
        network_utils.parse_network_family("solana:devnet")

    with pytest.raises(ValueError, match="network is required"):
        network_utils.parse_network_family(None)


def test_env_provider_private_key_validation_errors():
    with pytest.raises(ValueError, match="64 hex characters"):
        key_utils.decode_private_key("0x1234")

    with pytest.raises(ValueError, match="valid hex string"):
        key_utils.decode_private_key("z" * 64)


def test_env_provider_invalid_network_hits_error_branch():
    with pytest.raises(ValueError, match="network must start with"):
        network_utils.parse_network_family("solana:devnet")


def test_resolver_load_password_from_runtime_secrets_validation(tmp_path):
    path = tmp_path / "runtime_secrets.json"
    path.write_text(json.dumps(["bad"]), encoding="utf-8")
    with pytest.raises(ValueError, match="must contain a JSON object"):
        load_runtime_secrets_password(str(tmp_path))

    path.write_text(json.dumps({"password": 123}), encoding="utf-8")
    with pytest.raises(ValueError, match="password must be a string"):
        load_runtime_secrets_password(str(tmp_path))


def test_resolver_resolve_dir_and_password_helpers(tmp_path):
    env = {
        "AGENT_WALLET_DIR": "~/custom-wallet-dir",
        "AGENT_WALLET_PASSWORD": " env-password ",
    }
    assert resolver._resolve_dir(None, env).endswith("custom-wallet-dir")
    assert resolver._resolve_password(str(tmp_path), env) == "env-password"


def test_resolver_has_available_config_wallet_with_active_nonlocal():
    topology = resolver.WalletsTopology(
        active_wallet="hot",
        wallets={
            "hot": WalletConfig(
                type="raw_secret",
                params=RawSecretPrivateKeyParams(
                    source="private_key",
                    private_key="0x" + TEST_KEY.hex(),
                ),
            )
        },
    )
    assert resolver._has_available_config_wallet(topology) is True


def test_network_enum_values_are_stable():
    assert Network.EVM == "evm"
    assert Network.TRON == "tron"


def test_signer_modules_and_public_exports_load():
    import agent_wallet
    from agent_wallet import (
        EvmSigner,
        LocalSecureSigner,
        LocalSigner,
        RawSecretSigner,
        TronSigner,
    )
    from agent_wallet.core.adapters import local, local_secure, raw_secret
    from agent_wallet.core.config import (
        LocalSecureWalletParams,
        RawSecretPrivateKeyParams,
    )

    assert agent_wallet.LocalSigner is LocalSigner
    assert agent_wallet.LocalSecureSigner is LocalSecureSigner
    assert agent_wallet.RawSecretSigner is RawSecretSigner
    assert agent_wallet.EvmSigner is EvmSigner
    assert agent_wallet.TronSigner is TronSigner

    assert local.LocalSigner is LocalSigner
    assert local_secure.LocalSecureSigner is LocalSecureSigner
    assert raw_secret.RawSecretSigner is RawSecretSigner

    secure = LocalSecureSigner(
        params=LocalSecureWalletParams(secret_ref="secure"),
        config_dir=".",
        password="pw",
        network="eip155:1",
        secret_loader=lambda _dir, _pw, _ref: TEST_KEY,
    )
    raw = RawSecretSigner(
        params=RawSecretPrivateKeyParams(
            source="private_key",
            private_key="0x" + TEST_KEY.hex(),
        ),
        network="tron",
    )

    assert isinstance(secure, LocalSigner)
    assert isinstance(raw, LocalSigner)
    assert asyncio.run(secure.get_address()).startswith("0x")
    assert asyncio.run(raw.get_address()).startswith("T")
