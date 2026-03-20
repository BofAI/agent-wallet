"""
Demo: Resolve both TRON and EVM signers from one external env input.

This example maps one of these external environment variables into the SDK's
expected env vars:

  - `PRIVATE_KEY`
  - `MNEMONIC`
  - `WALLET_PASSWORD`
  - `MNEMONIC_ACCOUNT_INDEX` (optional, mnemonic mode only)

Then it resolves two wallet providers:

  - TRON via `resolve_wallet(network="tron")`
  - EVM via `resolve_wallet(network="eip155")`

Usage:
  PRIVATE_KEY=<hex> python examples/dual_sign_typed_data_from_private_key.py
  MNEMONIC="<words>" python examples/dual_sign_typed_data_from_private_key.py
  MNEMONIC="<words>" MNEMONIC_ACCOUNT_INDEX=1 python examples/dual_sign_typed_data_from_private_key.py
  WALLET_PASSWORD=<password> python examples/dual_sign_typed_data_from_private_key.py
"""

from __future__ import annotations

import asyncio
import os

from agent_wallet import resolve_wallet

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
    tron_wallet = await resolve_wallet(network="tron")
    tron_address = await tron_wallet.get_address()
    tron_signature = await tron_wallet.sign_typed_data(PAYMENT_PERMIT)

    evm_wallet = await resolve_wallet(network="eip155")
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
