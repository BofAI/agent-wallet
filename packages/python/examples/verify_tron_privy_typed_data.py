"""Verify TRON Privy sign_typed_data by recovering the TRON address
from the signature and comparing to the active wallet address.

Usage:
  AGENT_WALLET_DIR=/tmp/test-wallet \
  AGENT_WALLET_PASSWORD='Abc12345!@' \
  python examples/verify_tron_privy_typed_data.py
"""

from __future__ import annotations

import os

from eth_account.messages import _hash_eip191_message, encode_typed_data
from tronpy import keys

from agent_wallet.core.providers.config_provider import ConfigWalletProvider
from agent_wallet.core.resolver import resolve_wallet_provider

DIR = os.environ.get("AGENT_WALLET_DIR", "/tmp/test-wallet")
PASSWORD = os.environ.get("AGENT_WALLET_PASSWORD", "")
NETWORK = os.environ.get("AGENT_WALLET_NETWORK", "tron")

if not PASSWORD:
    raise SystemExit("AGENT_WALLET_PASSWORD is required to access local_secure wallets.")

provider = resolve_wallet_provider(network=NETWORK, dir=DIR)
if not isinstance(provider, ConfigWalletProvider):
    raise SystemExit("Expected a config-backed provider. Check AGENT_WALLET_DIR.")


def build_typed_data() -> dict:
    return {
        "domain": {
            "name": "AgentWallet",
            "version": "1",
            "chainId": 1,
        },
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
            ],
            "Message": [{"name": "contents", "type": "string"}],
        },
        "primaryType": "Message",
        "message": {"contents": "Hello"},
    }


def hash_typed_data(data: dict) -> bytes:
    signable = encode_typed_data(full_message=data)
    return bytes(_hash_eip191_message(signable))


def recover_tron_address(signature_hex: str, digest: bytes) -> str:
    sig_bytes = bytes.fromhex(signature_hex)
    if len(sig_bytes) != 65:
        raise ValueError(f"Expected 65-byte signature, got {len(sig_bytes)}")
    v = sig_bytes[64]
    if v in (0, 1):
        recovery = v
    elif v in (27, 28):
        recovery = v - 27
    else:
        raise ValueError(f"Invalid recovery id: {v}")
    sig = keys.Signature(sig_bytes[:64] + bytes([recovery]))
    pub = sig.recover_public_key_from_msg_hash(digest)
    return pub.to_base58check_address()


async def main() -> None:
    active_id = provider.get_active_id()
    if not active_id:
        raise SystemExit("No active wallet set.")

    wallet = await provider.get_active_wallet(NETWORK)
    address = await wallet.get_address()

    typed_data = build_typed_data()
    signature = await wallet.sign_typed_data(dict(typed_data))
    digest = hash_typed_data(typed_data)
    recovered = recover_tron_address(signature, digest)

    print(f"Active wallet: {active_id}")
    print(f"Wallet address: {address}")
    print(f"Recovered addr: {recovered}")
    print(f"Signature: {signature}")
    print(f"Verified: {recovered == address}")


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
