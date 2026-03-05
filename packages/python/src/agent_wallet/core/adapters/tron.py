"""TronWallet — Local TRON signing adapter (signing-only, no network calls)."""

from __future__ import annotations

import hashlib
import json
from typing import Optional

from agent_wallet.core.base import BaseWallet, Eip712Capable
from agent_wallet.core.errors import SigningError


class TronWallet(BaseWallet, Eip712Capable):
    """TRON wallet using local ECDSA signing.

    All operations are pure local — no network calls.
    """

    def __init__(
        self,
        private_key: bytes,
        api_key: Optional[str | dict] = None,
        chain_id: Optional[str] = None,
    ) -> None:
        from tronpy.keys import PrivateKey

        self._private_key_bytes = private_key
        self._tron_key = PrivateKey(private_key)
        self._address = self._tron_key.public_key.to_base58check_address()
        self._chain_id = chain_id or "tron:mainnet"

    async def get_address(self) -> str:
        return self._address

    async def sign_raw(self, raw_tx: bytes) -> str:
        """Sign raw bytes using ECDSA (keccak256 hash first, then sign)."""
        try:
            signature = self._tron_key.sign_msg(raw_tx)
            return signature.hex()
        except Exception as e:
            raise SigningError(f"Tron sign_raw failed: {e}") from e

    async def sign_transaction(self, payload: dict) -> str:
        """Sign a pre-built unsigned transaction from TronGrid.

        Accepts an unsigned tx object with { txID, raw_data_hex, raw_data }.
        The txID is SHA256(raw_data) — we sign the txID directly with secp256k1
        and return the signed tx as JSON with the signature attached.

        The caller (e.g. mcp-server-tron) is responsible for:
          1. Building the unsigned tx via TronGrid API
          2. Passing it here for signing
          3. Broadcasting the signed result
        """
        try:
            if "txID" not in payload or "raw_data_hex" not in payload:
                raise ValueError(
                    "Payload must be an unsigned transaction with {txID, raw_data_hex}. "
                    "Use TronGrid API to build the transaction first."
                )
            tx_id_bytes = bytes.fromhex(payload["txID"])
            signature = self._sign_digest(tx_id_bytes)
            signed_tx = {**payload, "signature": [signature]}
            return json.dumps(signed_tx, ensure_ascii=False)
        except SigningError:
            raise
        except Exception as e:
            raise SigningError(f"Tron sign_transaction failed: {e}") from e

    async def sign_message(self, msg: bytes) -> str:
        """Sign arbitrary message using ECDSA (keccak256 hash first)."""
        try:
            signature = self._tron_key.sign_msg(msg)
            return signature.hex()
        except Exception as e:
            raise SigningError(f"Tron sign_message failed: {e}") from e

    async def sign_typed_data(self, data: dict) -> str:
        """Sign EIP-712 typed data (using eth-account for hash construction).

        Tron uses the same ECDSA curve as Ethereum, so EIP-712 signing
        works with eth-account + tron private key.
        """
        try:
            from eth_account import Account
            from eth_account.messages import encode_typed_data

            signable = encode_typed_data(full_message=data)
            private_key_bytes = self._private_key_bytes
            signed = Account.sign_message(signable, private_key_bytes)
            return signed.signature.hex()
        except Exception as e:
            raise SigningError(f"Tron sign_typed_data failed: {e}") from e

    def _sign_digest(self, digest: bytes) -> str:
        """Sign a pre-hashed 32-byte digest directly with secp256k1.

        Used for transaction signing where the txID (SHA256 hash) is
        already computed by TronGrid. Returns r || s || v as hex string.
        """
        from tronpy.keys import PrivateKey

        # tronpy's sign_msg_hash signs a raw 32-byte digest without hashing
        signature = self._tron_key.sign_msg_hash(digest)
        return signature.hex()
