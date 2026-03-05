"""RemoteWallet — HTTP proxy adapter for remote signing server."""

from __future__ import annotations

from typing import Optional

from agent_wallet.core.base import BaseWallet
from agent_wallet.core.errors import NetworkError, SigningError


class RemoteWallet(BaseWallet):
    """Proxy wallet that forwards all operations to a remote agent-wallet server.

    Each RemoteWallet is bound to a specific wallet_id on the remote server.
    """

    def __init__(
        self,
        remote_url: str,
        wallet_id: str = "",
        token: Optional[str] = None,
    ) -> None:
        self._base_url = remote_url.rstrip("/")
        self._wallet_id = wallet_id
        self._token = token

    async def get_address(self) -> str:
        # TODO: GET {base_url}/wallets/{wallet_id}
        raise NotImplementedError("RemoteWallet not yet implemented")

    async def sign_raw(self, raw_tx: bytes) -> str:
        # TODO: POST {base_url}/wallets/{wallet_id}/sign/raw
        raise NotImplementedError("RemoteWallet not yet implemented")

    async def sign_transaction(self, payload: dict) -> str:
        # TODO: POST {base_url}/wallets/{wallet_id}/sign/transaction
        raise NotImplementedError("RemoteWallet not yet implemented")

    async def sign_message(self, msg: bytes) -> str:
        # TODO: POST {base_url}/wallets/{wallet_id}/sign/message
        raise NotImplementedError("RemoteWallet not yet implemented")
