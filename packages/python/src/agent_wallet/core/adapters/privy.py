"""Privy-backed wallet adapter."""

from __future__ import annotations

import hashlib
import json

from eth_utils import keccak

from agent_wallet.core.base import Eip712Capable, SignOptions, Wallet
from agent_wallet.core.clients.privy import PrivyClient
from agent_wallet.core.errors import SigningError, UnsupportedOperationError
from agent_wallet.core.utils.hex import strip_hex_prefix


class PrivyAdapter(Wallet, Eip712Capable):
    def __init__(
        self,
        *,
        app_id: str,
        app_secret: str,
        wallet_id: str,
        client: PrivyClient | None = None,
    ) -> None:
        self._wallet_id = wallet_id
        self._client = client or PrivyClient(
            app_id=app_id,
            app_secret=app_secret,
        )
        self._cached_address: str | None = None
        self._cached_chain_type: str | None = None

    async def get_address(self) -> str:
        if self._cached_address:
            return self._cached_address
        payload = self._client.get_wallet(self._wallet_id)
        data = payload.get("data", payload)
        address = data.get("address")
        if not address:
            raise SigningError("Privy wallet response missing address")
        self._cached_address = address
        chain_type = data.get("chain_type")
        self._cached_chain_type = chain_type.lower() if isinstance(chain_type, str) else None
        return address

    async def sign_raw(self, raw_tx: bytes, options: SignOptions | None = None) -> str:
        chain = await self._get_chain_type()
        if chain == "tron":
            return await self._tron_sign_bytes(raw_tx, options)
        raise UnsupportedOperationError("Privy adapter does not support raw transaction signing")

    async def sign_transaction(self, payload: dict, options: SignOptions | None = None) -> str:
        chain = await self._get_chain_type()
        if chain == "tron":
            return await self._tron_sign_transaction(payload, options)
        response = self._client.rpc(
            self._wallet_id,
            "eth_signTransaction",
            _normalize_transaction_payload(payload),
            options.authorization_signature if options else None,
        )
        signed = response.get("data", {}).get("signed_transaction")
        if not signed:
            raise SigningError("Privy eth_signTransaction did not return signed_transaction")
        return strip_hex_prefix(signed)

    async def sign_message(self, msg: bytes, options: SignOptions | None = None) -> str:
        chain = await self._get_chain_type()
        if chain == "tron":
            return await self._tron_sign_bytes(msg, options)
        hex_msg = "0x" + msg.hex()
        response = self._client.rpc(
            self._wallet_id,
            "personal_sign",
            {"message": hex_msg, "encoding": "hex"},
            options.authorization_signature if options else None,
        )
        signature = response.get("data", {}).get("signature")
        if not signature:
            raise SigningError("Privy signing response missing signature")
        return strip_hex_prefix(signature)

    async def sign_typed_data(self, data: dict, options: SignOptions | None = None) -> str:
        chain = await self._get_chain_type()
        if chain == "tron":
            return await self._tron_sign_typed_data(data, options)
        response = self._client.rpc(
            self._wallet_id,
            "eth_signTypedData_v4",
            _normalize_typed_data_payload(data),
            options.authorization_signature if options else None,
        )
        signature = response.get("data", {}).get("signature")
        if not signature:
            raise SigningError("Privy signing response missing signature")
        return strip_hex_prefix(signature)

    async def _get_chain_type(self) -> str:
        if self._cached_chain_type:
            return self._cached_chain_type
        payload = self._client.get_wallet(self._wallet_id)
        data = payload.get("data", payload)
        self._cached_address = data.get("address")
        chain_type = data.get("chain_type")
        self._cached_chain_type = chain_type.lower() if isinstance(chain_type, str) else None
        return self._cached_chain_type or ""

    async def _tron_sign_transaction(
        self, payload: dict, options: SignOptions | None = None
    ) -> str:
        tx_id, _ = _normalize_tron_payload(payload)
        signature = await self._tron_sign_hash(bytes.fromhex(tx_id), options)
        signed_tx = {**payload, "txID": tx_id, "signature": [signature]}
        return json.dumps(signed_tx, ensure_ascii=False)

    async def _tron_sign_bytes(
        self, data: bytes, options: SignOptions | None = None
    ) -> str:
        from tronpy.keys import hash_message

        digest = hash_message(data)
        return await self._tron_sign_hash(digest, options)

    async def _tron_sign_typed_data(
        self, data: dict, options: SignOptions | None = None
    ) -> str:
        from eth_account.messages import encode_typed_data

        payload = _normalize_typed_data_payload(data).get("typed_data", {})
        if not isinstance(payload, dict) or not payload:
            raise SigningError("Privy TRON typed data payload is missing typed_data")
        if "primary_type" in payload and "primaryType" not in payload:
            payload["primaryType"] = payload.pop("primary_type")
        signable = encode_typed_data(full_message=payload)
        digest = keccak(b"\x19" + signable.version + signable.header + signable.body)
        return await self._tron_sign_hash(digest, options)

    async def _tron_sign_hash(self, digest: bytes, options: SignOptions | None = None) -> str:
        response = self._client.raw_sign(
            self._wallet_id,
            {"hash": "0x" + digest.hex()},
            options.authorization_signature if options else None,
        )
        signature = response.get("data", {}).get("signature")
        if not signature:
            raise SigningError("Privy signing response missing signature")
        sig_hex = strip_hex_prefix(signature)
        sig_bytes = bytes.fromhex(sig_hex)
        if len(sig_bytes) != 64:
            raise SigningError("Privy raw_sign response must be 64-byte r||s for TRON")
        v = _recover_tron_v(sig_bytes, digest, await self.get_address())
        return (sig_hex + f"{v:02x}").lower()


def _normalize_transaction_payload(payload: dict) -> dict:
    has_transaction = isinstance(payload.get("transaction"), dict)
    tx = payload.get("transaction") if has_transaction else payload
    if not isinstance(tx, dict):
        return payload
    normalized: dict[str, object] = {}
    mapped_keys = {
        "to",
        "data",
        "value",
        "nonce",
        "chain_id",
        "chainId",
        "gas_limit",
        "gas",
        "max_fee_per_gas",
        "maxFeePerGas",
        "max_priority_fee_per_gas",
        "maxPriorityFeePerGas",
        "gas_price",
        "gasPrice",
        "access_list",
        "accessList",
        "type",
    }

    def _pick(*keys: str):
        for key in keys:
            if key in tx:
                return tx[key]
        return None

    def _assign(key: str, value: object | None):
        if value is not None:
            normalized[key] = value

    _assign("to", tx.get("to"))
    _assign("data", tx.get("data"))
    _assign("value", _pick("value"))
    _assign("nonce", _pick("nonce"))
    _assign("chain_id", _pick("chain_id", "chainId"))
    _assign("gas_limit", _pick("gas_limit", "gas"))
    _assign("max_fee_per_gas", _pick("max_fee_per_gas", "maxFeePerGas"))
    _assign("max_priority_fee_per_gas", _pick("max_priority_fee_per_gas", "maxPriorityFeePerGas"))
    _assign("gas_price", _pick("gas_price", "gasPrice"))
    _assign("access_list", _pick("access_list", "accessList"))
    _assign("type", _pick("type"))

    for key, value in tx.items():
        if key not in mapped_keys and key not in normalized:
            normalized[key] = value
    for field in (
        "value",
        "gas_limit",
        "nonce",
        "chain_id",
        "max_fee_per_gas",
        "max_priority_fee_per_gas",
        "gas_price",
    ):
        if field in normalized:
            normalized[field] = _to_hex_value(normalized[field])
    if has_transaction:
        return {**payload, "transaction": normalized}
    return {"transaction": normalized}


def _to_hex_value(value):
    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed:
            return value
        if trimmed.startswith("0x"):
            return trimmed
        if trimmed.isdigit():
            return hex(int(trimmed))
        return value
    if isinstance(value, int):
        return hex(value)
    return value


def _normalize_typed_data_payload(data: dict) -> dict:
    payload = data if "typed_data" in data else {"typed_data": data}
    typed = payload.get("typed_data")
    if isinstance(typed, dict) and "primaryType" in typed and "primary_type" not in typed:
        typed["primary_type"] = typed.pop("primaryType")
    return payload


def _normalize_tron_payload(payload: dict) -> tuple[str, str]:
    raw_data_hex = payload.get("raw_data_hex")
    if not isinstance(raw_data_hex, str) or not raw_data_hex.strip():
        raise SigningError("Payload must include raw_data_hex for TRON signing")
    raw_data_hex = strip_hex_prefix(raw_data_hex.strip())
    tx_id = payload.get("txID") or payload.get("txId") or payload.get("tx_id")
    if isinstance(tx_id, str) and tx_id.strip():
        normalized = strip_hex_prefix(tx_id.strip())
        if not _is_32_byte_hex(normalized):
            raise SigningError("Payload txID must be a 32-byte hex string")
        return normalized, raw_data_hex
    digest = hashlib.sha256(bytes.fromhex(raw_data_hex)).hexdigest()
    return digest, raw_data_hex


def _recover_tron_v(signature_rs: bytes, digest: bytes, address: str) -> int:
    from tronpy import keys

    for v in (0, 1):
        try:
            sig = keys.Signature(signature_rs + bytes([v]))
            pub = sig.recover_public_key_from_msg_hash(digest)
            if pub.to_base58check_address() == address:
                return v
        except Exception:
            continue
    raise UnsupportedOperationError("Unable to derive recovery id for TRON signature")


def _is_32_byte_hex(value: str) -> bool:
    if len(value) != 64:
        return False
    try:
        int(value, 16)
    except ValueError:
        return False
    return True
