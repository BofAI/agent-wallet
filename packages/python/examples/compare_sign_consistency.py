"""Compare sign input/output consistency across default_secure (EVM/TRON)

and privy wallets (privy_evm / privy_tron_2).

Usage:
  AGENT_WALLET_DIR=/tmp/test-wallet \
  AGENT_WALLET_PASSWORD='Abc12345!@' \
  python examples/compare_sign_consistency.py
"""

from __future__ import annotations

import json
import os

from agent_wallet.core.providers.config_provider import ConfigWalletProvider
from agent_wallet.core.resolver import resolve_wallet_provider

DIR = os.environ.get("AGENT_WALLET_DIR", "/tmp/test-wallet")
PASSWORD = os.environ.get("AGENT_WALLET_PASSWORD", "")
DEFAULT_SECURE_ID = os.environ.get("DEFAULT_SECURE_WALLET_ID", "default_secure")
PRIVY_EVM_ID = os.environ.get("PRIVY_EVM_WALLET_ID", "privy_evm")
PRIVY_TRON_ID = os.environ.get("PRIVY_TRON_WALLET_ID", "privy_tron_2")
EVM_NETWORK = os.environ.get("EVM_NETWORK", "eip155:1")
TRON_NETWORK = os.environ.get("TRON_NETWORK", "tron")

if not PASSWORD:
    raise SystemExit("AGENT_WALLET_PASSWORD is required for default_secure testing.")

provider = resolve_wallet_provider(network=None, dir=DIR)
if not isinstance(provider, ConfigWalletProvider):
    raise SystemExit("Expected a config-backed provider. Check AGENT_WALLET_DIR.")

EVM_TX_PAYLOAD = {
    "to": "0x0000000000000000000000000000000000000001",
    "chainId": 1,
    "gas": 21000,
    "nonce": 0,
    "maxFeePerGas": 1000000000,
    "maxPriorityFeePerGas": 1000000,
    "value": 0,
}

TRON_TX_PAYLOAD = {
    "raw_data_hex": "abcd",
}

TYPED_DATA = {
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


def describe_output(value: str) -> dict[str, object]:
    trimmed = value.strip()
    if trimmed.startswith("{") and trimmed.endswith("}"):
        try:
            return {"kind": "json", "parsed": json.loads(trimmed)}
        except json.JSONDecodeError:
            pass
    has_0x = trimmed.startswith("0x")
    hex_value = trimmed[2:] if has_0x else trimmed
    return {
        "kind": "hex",
        "has0x": has_0x,
        "length": len(hex_value),
        "sample": f"{trimmed[:10]}...{trimmed[-10:]}",
    }


def compare_hex(a: dict[str, object], b: dict[str, object]) -> bool:
    return a.get("kind") == "hex" and b.get("kind") == "hex" and a.get("has0x") == b.get("has0x")


def compare_json(a: dict[str, object], b: dict[str, object]) -> bool:
    if a.get("kind") != "json" or b.get("kind") != "json":
        return False
    a_keys = ",".join(sorted(a["parsed"].keys()))
    b_keys = ",".join(sorted(b["parsed"].keys()))
    return a_keys == b_keys


async def main() -> None:
    default_secure_evm = await provider.get_wallet(DEFAULT_SECURE_ID, EVM_NETWORK)
    default_secure_tron = await provider.get_wallet(DEFAULT_SECURE_ID, TRON_NETWORK)
    privy_evm = await provider.get_wallet(PRIVY_EVM_ID)
    privy_tron = await provider.get_wallet(PRIVY_TRON_ID)

    print("== Input shapes ==")
    print("EVM tx payload (both):", json.dumps(EVM_TX_PAYLOAD))
    print("TRON tx payload (both):", json.dumps(TRON_TX_PAYLOAD))
    print()

    print("== sign msg ==")
    msg = b"hello"
    msg_default_evm = describe_output(await default_secure_evm.sign_message(msg))
    msg_privy_evm = describe_output(await privy_evm.sign_message(msg))
    msg_default_tron = describe_output(await default_secure_tron.sign_message(msg))
    msg_privy_tron = describe_output(await privy_tron.sign_message(msg))
    print("EVM default_secure:", msg_default_evm)
    print("EVM privy:", msg_privy_evm)
    print("TRON default_secure:", msg_default_tron)
    print("TRON privy:", msg_privy_tron)
    print("EVM consistent:", compare_hex(msg_default_evm, msg_privy_evm))
    print("TRON consistent:", compare_hex(msg_default_tron, msg_privy_tron))
    print()

    print("== sign tx ==")
    tx_default_evm = describe_output(await default_secure_evm.sign_transaction(EVM_TX_PAYLOAD))
    tx_privy_evm = describe_output(await privy_evm.sign_transaction(EVM_TX_PAYLOAD))
    tx_default_tron = describe_output(await default_secure_tron.sign_transaction(TRON_TX_PAYLOAD))
    tx_privy_tron = describe_output(await privy_tron.sign_transaction(TRON_TX_PAYLOAD))
    print("EVM default_secure:", tx_default_evm)
    print("EVM privy:", tx_privy_evm)
    print("TRON default_secure:", tx_default_tron)
    print("TRON privy:", tx_privy_tron)
    print("EVM consistent:", compare_hex(tx_default_evm, tx_privy_evm))
    print("TRON consistent:", compare_json(tx_default_tron, tx_privy_tron))
    print()

    print("== sign typed-data ==")
    td_default_evm = describe_output(await default_secure_evm.sign_typed_data(json.loads(json.dumps(TYPED_DATA))))
    td_privy_evm = describe_output(await privy_evm.sign_typed_data(json.loads(json.dumps(TYPED_DATA))))
    td_default_tron = describe_output(await default_secure_tron.sign_typed_data(json.loads(json.dumps(TYPED_DATA))))
    td_privy_tron = describe_output(await privy_tron.sign_typed_data(json.loads(json.dumps(TYPED_DATA))))
    print("EVM default_secure:", td_default_evm)
    print("EVM privy:", td_privy_evm)
    print("TRON default_secure:", td_default_tron)
    print("TRON privy:", td_privy_tron)
    print("EVM consistent:", compare_hex(td_default_evm, td_privy_evm))
    print("TRON consistent:", compare_hex(td_default_tron, td_privy_tron))
    print()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
