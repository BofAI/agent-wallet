"""
Demo: Resolve both TRON and EVM signers from one external env input.

This example maps one of these external environment variables into the SDK's
expected env vars:

  - `PRIVATE_KEY`
  - `MNEMONIC`
  - `WALLET_PASSWORD`

Then it resolves two wallet providers:

  - TRON via `resolve_wallet_provider(network="tron")`
  - EVM via `resolve_wallet_provider(network="eip155")`

Usage:
  PRIVATE_KEY=<hex> python examples/dual_sign_typed_data_from_private_key.py
  MNEMONIC="<words>" python examples/dual_sign_typed_data_from_private_key.py
  WALLET_PASSWORD=<password> python examples/dual_sign_typed_data_from_private_key.py
"""

from __future__ import annotations

import asyncio
import os

from agent_wallet import resolve_wallet_provider

PAYMENT_PERMIT = {
    "types": {
        "EIP712Domain": [
            {"name": "name", "type": "string"},
            {"name": "chainId", "type": "uint256"},
            {"name": "verifyingContract", "type": "address"},
        ],
        "PaymentPermitDetails": [
            {"name": "buyer", "type": "address"},
            {"name": "amount", "type": "uint256"},
            {"name": "nonce", "type": "uint256"},
        ],
    },
    "primaryType": "PaymentPermitDetails",
    "domain": {
        "name": "x402PaymentPermit",
        "chainId": 1,
        "verifyingContract": "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
    },
    "message": {
        "buyer": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "amount": 1000000,
        "nonce": 0,
    },
}


async def main():
    private_key = os.environ.get("PRIVATE_KEY", "").strip()
    mnemonic = os.environ.get("MNEMONIC", "").strip()
    wallet_password = os.environ.get("WALLET_PASSWORD", "").strip()
    configured_modes = sum(bool(value) for value in (private_key, mnemonic, wallet_password))

    if configured_modes > 1:
        raise RuntimeError("Set only one of PRIVATE_KEY, MNEMONIC, or WALLET_PASSWORD.")
    if configured_modes == 0:
        raise RuntimeError(
            "Set PRIVATE_KEY, MNEMONIC, or WALLET_PASSWORD before running this example."
        )

    # Map the caller's generic env var into the SDK's expected env vars.
    os.environ.pop("AGENT_WALLET_PRIVATE_KEY", None)
    os.environ.pop("AGENT_WALLET_MNEMONIC", None)
    os.environ.pop("AGENT_WALLET_PASSWORD", None)
    if private_key:
        os.environ["AGENT_WALLET_PRIVATE_KEY"] = private_key
    elif mnemonic:
        os.environ["AGENT_WALLET_MNEMONIC"] = mnemonic
    else:
        os.environ["AGENT_WALLET_PASSWORD"] = wallet_password

    tron_provider = resolve_wallet_provider(network="tron")
    tron_wallet = await tron_provider.get_active_wallet()
    tron_address = await tron_wallet.get_address()
    tron_signature = await tron_wallet.sign_typed_data(PAYMENT_PERMIT)

    evm_provider = resolve_wallet_provider(network="eip155")
    evm_wallet = await evm_provider.get_active_wallet()
    evm_address = await evm_wallet.get_address()
    evm_signature = await evm_wallet.sign_typed_data(PAYMENT_PERMIT)

    print("=== TRON ===")
    print(f"Address:    {tron_address}")
    print(f"Signature:  {tron_signature}")
    print()

    print("=== EVM ===")
    print(f"Address:    {evm_address}")
    print(f"Signature:  {evm_signature}")


if __name__ == "__main__":
    asyncio.run(main())
