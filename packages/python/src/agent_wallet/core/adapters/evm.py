"""EvmAdapter — Local EVM signing adapter using eth-account."""

from __future__ import annotations

from agent_wallet.core.base import Eip712Capable, Wallet
from agent_wallet.core.errors import SigningError


class EvmAdapter(Wallet, Eip712Capable):
    """EVM wallet using local ECDSA signing via eth-account."""

    def __init__(self, private_key: bytes, network: str = "eip155") -> None:
        from eth_account import Account

        self._account = Account.from_key(private_key)
        self._network = network

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
            from eth_account.messages import encode_defunct

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
            from eth_account.messages import encode_typed_data

            signable = encode_typed_data(full_message=data)
            signed = self._account.sign_message(signable)
            return signed.signature.hex()
        except Exception as e:
            raise SigningError(f"EVM sign_typed_data failed: {e}") from e
