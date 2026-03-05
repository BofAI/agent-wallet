"""EvmWallet — Local EVM signing adapter using eth-account."""

from __future__ import annotations

from typing import Any, Optional

from eth_account import Account
from eth_account.messages import encode_defunct, encode_typed_data

from agent_wallet.core.base import BaseWallet, Eip712Capable
from agent_wallet.core.errors import SigningError


class EvmWallet(BaseWallet, Eip712Capable):
    """EVM wallet using local ECDSA signing via eth-account."""

    def __init__(self, private_key: bytes, chain_id: Optional[str] = None) -> None:
        self._account = Account.from_key(private_key)
        self._chain_id = chain_id

    async def get_address(self) -> str:
        return self._account.address

    async def sign_raw(self, raw_tx: bytes) -> str:
        try:
            signed = self._account.sign_transaction(raw_tx)
            return signed.raw_transaction.hex()
        except Exception as e:
            raise SigningError(f"EVM sign_raw failed: {e}") from e

    async def sign_transaction(self, payload: dict) -> str:
        try:
            signed = self._account.sign_transaction(payload)
            return signed.raw_transaction.hex()
        except Exception as e:
            raise SigningError(f"EVM sign_transaction failed: {e}") from e

    async def sign_message(self, msg: bytes) -> str:
        try:
            signable = encode_defunct(primitive=msg)
            signed = self._account.sign_message(signable)
            return signed.signature.hex()
        except Exception as e:
            raise SigningError(f"EVM sign_message failed: {e}") from e

    async def sign_typed_data(self, data: dict) -> str:
        """Sign EIP-712 typed data.

        Expects data in full EIP-712 format:
        {
            "types": {"EIP712Domain": [...], "MyType": [...]},
            "primaryType": "MyType",
            "domain": {...},
            "message": {...}
        }
        """
        try:
            signable = encode_typed_data(full_message=data)
            signed = self._account.sign_message(signable)
            return signed.signature.hex()
        except Exception as e:
            raise SigningError(f"EVM sign_typed_data failed: {e}") from e
