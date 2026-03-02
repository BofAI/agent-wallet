import pytest
from unittest.mock import MagicMock, AsyncMock
from tronpy import AsyncTron
from wallet.tron_provider import TronProvider
from keystore.keystore import Keystore
import os
import tempfile

@pytest.fixture
def mock_tron_client(mocker):
    mock_client = AsyncMock(spec=AsyncTron)
    mocker.patch('wallet.tron_provider.AsyncTron', return_value=mock_client)
    # Also patch the provider inside TronProvider init or just mock the client attribute
    return mock_client

@pytest.fixture
def provider(mock_tron_client):
    d = tempfile.mkdtemp(prefix="tron-provider-ks-")
    try:
        # Mock AsyncHTTPProvider to avoid network calls during init
        with pytest.MonkeyPatch.context() as m:
            m.setattr("wallet.tron_provider.AsyncHTTPProvider", MagicMock())
            # Mock PrivateKey to avoid errors with dummy key
            m.setattr("wallet.tron_provider.PrivateKey", MagicMock())

            fp = os.path.join(d, "Keystore")
            Keystore.to_file(fp, {"privateKey": "00" * 32})
            p = TronProvider(keystore_path=fp)
            # Manually set the client to our mock because __init__ creates a new instance
            p.client = mock_tron_client
            p._key = MagicMock()
            p.address = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"
            yield p
    finally:
        try:
            import shutil
            shutil.rmtree(d, ignore_errors=True)
        except Exception:
            pass

@pytest.mark.asyncio
async def test_get_balance(provider, mock_tron_client):
    mock_tron_client.get_account_balance.return_value = 100.5
    balance = await provider.get_balance()
    assert balance == 100.5
    mock_tron_client.get_account_balance.assert_called_with("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb")

@pytest.mark.asyncio
async def test_get_trc20_balance(provider, mock_tron_client):
    mock_contract = AsyncMock()
    mock_contract.functions.balanceOf.return_value = 1000
    mock_tron_client.get_contract.return_value = mock_contract
    
    balance = await provider.get_trc20_balance("wallet_addr", "contract_addr")
    assert balance == 1000
    mock_tron_client.get_contract.assert_called_with("contract_addr")
    mock_contract.functions.balanceOf.assert_called_with("wallet_addr")

@pytest.mark.asyncio
async def test_send_transaction(provider, mock_tron_client):
    # Mock transaction builder chain
    mock_txn = MagicMock()
    # Mock the chain: transfer -> memo -> fee_limit -> build -> sign -> broadcast
    mock_builder = MagicMock()
    mock_builder.memo.return_value = mock_builder
    mock_builder.fee_limit.return_value = mock_builder
    # .build is async
    mock_builder.build = AsyncMock(return_value=mock_txn)
    
    # trx.transfer returns the builder
    mock_tron_client.trx.transfer.return_value = mock_builder
    
    # txn.sign returns signed_txn (synchronous)
    mock_signed_txn = MagicMock()
    # broadcast is async method on signed txn
    mock_signed_txn.broadcast = AsyncMock(return_value={'result': True, 'txid': '123'})
    
    mock_txn.sign.return_value = mock_signed_txn

    result = await provider.send_transaction("recipient_addr", 50.0)

    assert result["result"] is True
    assert result["txid"] == "123"
    mock_tron_client.trx.transfer.assert_called_with(provider.address, "recipient_addr", 50.0)


@pytest.mark.asyncio
async def test_get_account_info(provider):
    info = await provider.get_account_info()
    assert info == {"address": "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"}


@pytest.mark.asyncio
async def test_sign_tx(provider):
    mock_txn = MagicMock()
    mock_signed = MagicMock()
    mock_signed._signature = ["sig-hex"]
    mock_txn.sign.return_value = mock_signed
    result = await provider.sign_tx(mock_txn)
    assert result["signed_tx"] is mock_signed
    assert result["signature"] == "sig-hex"


@pytest.mark.asyncio
async def test_sign_message(provider):
    class _Sig:
        def hex(self):
            return "msg-sig-hex"

    provider._key.sign_msg_hash.return_value = _Sig()
    sig = await provider.sign_message(b"hello")
    assert sig == "msg-sig-hex"
