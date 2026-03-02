import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from wallet.flash_provider import FlashProvider
from keystore.keystore import Keystore
import os
import tempfile

@pytest.fixture
def mock_tron_client(mocker):
    mock_client = AsyncMock()
    mocker.patch('wallet.tron_provider.AsyncTron', return_value=mock_client)
    return mock_client

@pytest.fixture
def provider(mock_tron_client):
    d = tempfile.mkdtemp(prefix="flash-provider-ks-")
    try:
        with pytest.MonkeyPatch.context() as m:
            m.setattr("wallet.tron_provider.AsyncHTTPProvider", MagicMock())
            # FlashProvider extends TronProvider
            fp = os.path.join(d, "Keystore")
            Keystore.to_file(
                fp,
                {
                    "privyAppId": "mock_id",
                    "privyAppSecret": "mock_secret",
                    "walletId": "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
                },
            )
            p = FlashProvider(
                keystore_path=fp,
            )
            p.client = mock_tron_client
            p.flash_client = mock_tron_client  # Use same mock for simplicity
            p.address = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"
            yield p
    finally:
        try:
            import shutil
            shutil.rmtree(d, ignore_errors=True)
        except Exception:
            pass

@pytest.mark.asyncio
async def test_sign_transaction_privy(provider):
    # Mock transaction
    mock_txn = MagicMock()
    mock_txn.txid = "deadbeef"
    # Mock signature insertion logic in FlashProvider
    # In reality tronpy objs are complex, but we mock the attribute access
    
    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client_cls.return_value.__aenter__.return_value = mock_client
        
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"signature": "somesig"}
        mock_client.post.return_value = mock_resp
        
        signed_txn = await provider.sign_transaction(mock_txn)
        
        assert signed_txn._signature == ["somesig"]
        
        # Verify API call
        mock_client.post.assert_called_once()
        args, kwargs = mock_client.post.call_args
        assert kwargs['json']['params']['message'] == "deadbeef"
        assert kwargs['headers']['privy-app-id'] == "mock_id"

@pytest.mark.asyncio
async def test_send_transaction_privy(provider, mock_tron_client):
    # Mock builder
    mock_txn = MagicMock()
    mock_txn.txid = "deadbeef"
    # ... (rest of setup) ...

    # Skip lines 57-60 as they are inside the function body and we match on function def start
    # Wait, replace_file_content replaces lines. I need to be careful.
    
    # Let's just replace the call site and function name if I can target them.
    # The tool works on line ranges. 
    
    # I'll replace the whole function to be safe and clean.
    mock_builder = MagicMock()
    mock_builder.memo.return_value = mock_builder
    mock_builder.fee_limit.return_value = mock_builder
    mock_builder.build = AsyncMock(return_value=mock_txn)
    
    # Override client.trx with MagicMock to avoid AsyncMock issues
    provider.client.trx = MagicMock()
    provider.client.trx.transfer.return_value = mock_builder
    
    # Mock broadcast on signed txn
    mock_txn.broadcast = AsyncMock(return_value={"result": True, "txid": "deadbeef"})
    
    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client_cls.return_value.__aenter__.return_value = mock_client
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"signature": "somesig"}
        mock_client.post.return_value = mock_resp
        
        result = await provider.send_transaction("recipient", 100)
        
        assert result["result"] is True
        assert mock_txn._signature == ["somesig"]
        mock_txn.broadcast.assert_called_once()


@pytest.mark.asyncio
async def test_sign_message_privy(provider):
    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client_cls.return_value.__aenter__.return_value = mock_client

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"signature": "msgsig"}
        mock_client.post.return_value = mock_resp

        sig = await provider.sign_message(b"hello")
        assert sig == "msgsig"

        _, kwargs = mock_client.post.call_args
        assert kwargs["json"]["params"]["message"] == "68656c6c6f"  # "hello" in hex
        assert kwargs["json"]["params"]["encoding"] == "hex"
