"""TronSigner — Local TRON signing helper (signing-only, no network calls)."""

from __future__ import annotations

import hashlib
import json

from agent_wallet.core.base import Eip712Capable, SignOptions, Wallet
from agent_wallet.core.errors import SigningError


class TronSigner(Wallet, Eip712Capable):
    """TRON wallet using local ECDSA signing.

    All operations are pure local — no network calls.
    """

    def __init__(self, private_key: bytes, network: str = "tron") -> None:
        from tronpy.keys import PrivateKey

        self._private_key_bytes = private_key
        self._tron_key = PrivateKey(private_key)
        self._address = self._tron_key.public_key.to_base58check_address()
        self._network = network

    async def get_address(self) -> str:
        return self._address

    async def sign_raw(self, raw_tx: bytes, options: SignOptions | None = None) -> str:
        """Sign raw bytes using ECDSA (keccak256 hash first, then sign)."""
        try:
            signature = self._tron_key.sign_msg(raw_tx)
            return signature.hex()
        except Exception as e:
            raise SigningError(f"Tron sign_raw failed: {e}") from e

    async def sign_transaction(self, payload: dict, options: SignOptions | None = None) -> str:
        """Sign a pre-built unsigned transaction from TronGrid.

        Accepts an unsigned tx object with { raw_data_hex } and optional txID/raw_data.
        If txID is missing, compute SHA256(raw_data_hex) locally.
        Sign the txID directly and return the signed tx as JSON with the signature attached.

        The caller (e.g. mcp-server-tron) is responsible for:
          1. Building the unsigned tx via TronGrid API
          2. Passing it here for signing
          3. Broadcasting the signed result
        """
        try:
            if "raw_data_hex" not in payload:
                raise ValueError(
                    "Payload must be an unsigned transaction with {raw_data_hex}. "
                    "Use TronGrid API to build the transaction first."
                )
            raw_data_hex = str(payload["raw_data_hex"]).removeprefix("0x")
            tx_id = str(payload.get("txID") or "").removeprefix("0x")
            if tx_id:
                if len(tx_id) != 64:
                    raise ValueError("Payload txID must be a 32-byte hex string")
                tx_id_bytes = bytes.fromhex(tx_id)
            else:
                tx_id_bytes = hashlib.sha256(bytes.fromhex(raw_data_hex)).digest()
                tx_id = tx_id_bytes.hex()
            signature = self._sign_digest(tx_id_bytes)
            signed_tx = {**payload, "txID": tx_id, "signature": [signature]}
            return json.dumps(signed_tx, ensure_ascii=False)
        except SigningError:
            raise
        except Exception as e:
            raise SigningError(f"Tron sign_transaction failed: {e}") from e

    async def sign_message(self, msg: bytes, options: SignOptions | None = None) -> str:
        """Sign arbitrary message using ECDSA (keccak256 hash first)."""
        try:
            signature = self._tron_key.sign_msg(msg)
            return signature.hex()
        except Exception as e:
            raise SigningError(f"Tron sign_message failed: {e}") from e

    async def sign_typed_data(self, data: dict, options: SignOptions | None = None) -> str:
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

        # tronpy's sign_msg_hash signs a raw 32-byte digest without hashing
        signature = self._tron_key.sign_msg_hash(digest)
        return signature.hex()
