"""Tests for Privy adapter behavior."""

from __future__ import annotations

import pytest

from agent_wallet.core.adapters.privy import PrivyAdapter
from agent_wallet.core.errors import UnsupportedOperationError


class FakePrivyClient:
    def __init__(
        self,
        *,
        chain_type: str = "ethereum",
        address: str = "0xabc",
        raw_signature: str = "0xdead",
    ) -> None:
        self.calls: list[tuple[str, str, dict]] = []
        self.wallet_calls: list[str] = []
        self.raw_calls: list[str] = []
        self.chain_type = chain_type
        self.address = address
        self.raw_signature = raw_signature

    def get_wallet(self, wallet_id: str):
        self.wallet_calls.append(wallet_id)
        return {"data": {"address": self.address, "chain_type": self.chain_type}}

    def rpc(
        self,
        wallet_id: str,
        method: str,
        params: dict,
        authorization_signature: str | None = None,
    ):
        self.calls.append((wallet_id, method, params))
        if method == "eth_signTransaction":
            return {"data": {"signed_transaction": "0xsigned"}}
        return {"data": {"signature": "0xsig"}}

    def raw_sign(
        self,
        wallet_id: str,
        params: dict,
        authorization_signature: str | None = None,
    ):
        self.raw_calls.append(wallet_id)
        return {"data": {"signature": self.raw_signature}}


@pytest.mark.asyncio
async def test_sign_message_maps_to_personal_sign():
    client = FakePrivyClient()
    adapter = PrivyAdapter(
        app_id="app",
        app_secret="secret",
        wallet_id="wallet-1",
        client=client,
    )

    signature = await adapter.sign_message(b"\x01\x02\x03")
    assert signature == "sig"
    _, method, params = client.calls[0]
    assert method == "personal_sign"
    assert params["encoding"] == "hex"
    assert params["message"] == "0x010203"


@pytest.mark.asyncio
async def test_sign_transaction_maps_to_eth_sign_transaction():
    client = FakePrivyClient()
    adapter = PrivyAdapter(
        app_id="app",
        app_secret="secret",
        wallet_id="wallet-1",
        client=client,
    )

    signed = await adapter.sign_transaction(
        {
            "transaction": {
                "to": "0x1",
                "chain_id": 1,
                "gas_limit": 21000,
                "nonce": "0",
                "max_fee_per_gas": 1000000000,
                "max_priority_fee_per_gas": "1000000",
                "value": 0,
            }
        }
    )
    assert signed == "signed"
    assert client.calls[0][1] == "eth_signTransaction"
    params = client.calls[0][2]["transaction"]
    assert params["chain_id"] == "0x1"
    assert params["gas_limit"] == "0x5208"
    assert params["max_fee_per_gas"] == "0x3b9aca00"
    assert params["max_priority_fee_per_gas"] == "0xf4240"
    assert params["value"] == "0x0"


@pytest.mark.asyncio
async def test_sign_typed_data_maps_to_eth_sign_typed_data():
    client = FakePrivyClient()
    adapter = PrivyAdapter(
        app_id="app",
        app_secret="secret",
        wallet_id="wallet-1",
        client=client,
    )

    signature = await adapter.sign_typed_data(
        {"domain": {}, "types": {}, "message": {}, "primaryType": "Message"}
    )
    assert signature == "sig"
    assert client.calls[0][1] == "eth_signTypedData_v4"
    assert "typed_data" in client.calls[0][2]
    assert client.calls[0][2]["typed_data"]["primary_type"] == "Message"


@pytest.mark.asyncio
async def test_sign_transaction_accepts_viem_payload():
    client = FakePrivyClient()
    adapter = PrivyAdapter(
        app_id="app",
        app_secret="secret",
        wallet_id="wallet-1",
        client=client,
    )

    signed = await adapter.sign_transaction(
        {
            "to": "0x1",
            "chainId": 1,
            "gas": 21000,
            "nonce": 0,
            "maxFeePerGas": 1000000000,
            "maxPriorityFeePerGas": 1000000,
            "value": 0,
        }
    )
    assert signed == "signed"
    assert client.calls[0][1] == "eth_signTransaction"
    params = client.calls[0][2]["transaction"]
    assert params["chain_id"] == "0x1"
    assert params["gas_limit"] == "0x5208"
    assert params["max_fee_per_gas"] == "0x3b9aca00"
    assert params["max_priority_fee_per_gas"] == "0xf4240"
    assert params["value"] == "0x0"


@pytest.mark.asyncio
async def test_sign_raw_is_unsupported():
    client = FakePrivyClient(chain_type="ethereum")
    adapter = PrivyAdapter(
        app_id="app",
        app_secret="secret",
        wallet_id="wallet-1",
        client=client,
    )

    with pytest.raises(UnsupportedOperationError):
        await adapter.sign_raw(b"\x01")


@pytest.mark.asyncio
async def test_tron_sign_message_uses_raw_sign_and_appends_v():
    from tronpy.keys import PrivateKey

    key = PrivateKey(b"\x01" * 32)
    address = key.public_key.to_base58check_address()
    sig = key.sign_msg(b"\x01\x02\x03")
    raw_sig = sig.to_bytes()[:64].hex()

    client = FakePrivyClient(
        chain_type="tron",
        address=address,
        raw_signature="0x" + raw_sig,
    )
    adapter = PrivyAdapter(
        app_id="app",
        app_secret="secret",
        wallet_id="wallet-1",
        client=client,
    )

    signature = await adapter.sign_message(b"\x01\x02\x03")
    assert signature == sig.hex()
    assert len(client.raw_calls) == 1


@pytest.mark.asyncio
async def test_get_address_caches():
    client = FakePrivyClient()
    adapter = PrivyAdapter(
        app_id="app",
        app_secret="secret",
        wallet_id="wallet-1",
        client=client,
    )

    await adapter.get_address()
    await adapter.get_address()
    assert len(client.wallet_calls) == 1
