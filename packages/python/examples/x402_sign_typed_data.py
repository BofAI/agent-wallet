"""
Demo: Sign EIP-712 typed data for x402 payment permit using agent-wallet SDK.

This example shows how x402 integrations (e.g. mcp-server-tron) can use
the agent-wallet SDK to sign EIP-712 structured data — the same format
used by x402's PaymentPermit.

agent-wallet's sign_typed_data() is fully compatible with x402's signing:
  - Supports domains with or without "version" field
  - Same ECDSA curve (secp256k1) for both EVM and Tron
  - Identical signatures for the same key + data, regardless of chain

Prerequisites:
  - agent-wallet init
  - agent-wallet add (a tron_local or evm_local wallet)

Usage:
  AGENT_WALLET_PASSWORD=<your-password> python examples/x402_sign_typed_data.py
"""

import asyncio
import os

from agent_wallet import WalletFactory

# --- Configuration ---

SECRETS_DIR = os.environ.get("AGENT_WALLET_DIR", os.path.expanduser("~/.agent-wallet"))
PASSWORD = os.environ.get("AGENT_WALLET_PASSWORD", "")
WALLET_ID = "wallet-b"  # tron_local wallet


# --- x402 PaymentPermit typed data ---

# This is the exact format x402 uses for payment authorization.
# EIP712Domain does NOT include "version" — this is intentional and
# agent-wallet handles it correctly.

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
        "chainId": 728126428,  # Tron chain ID (use 1 for Ethereum mainnet)
        "verifyingContract": "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
    },
    "message": {
        "buyer": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "amount": 1000000,
        "nonce": 0,
    },
}

# Standard EIP-712 with "version" field also works:

STANDARD_TYPED_DATA = {
    "types": {
        "EIP712Domain": [
            {"name": "name", "type": "string"},
            {"name": "version", "type": "string"},
            {"name": "chainId", "type": "uint256"},
            {"name": "verifyingContract", "type": "address"},
        ],
        "Transfer": [
            {"name": "to", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
    },
    "primaryType": "Transfer",
    "domain": {
        "name": "MyDApp",
        "version": "1",
        "chainId": 728126428,
        "verifyingContract": "0x1234567890abcdef1234567890abcdef12345678",
    },
    "message": {
        "to": "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
        "amount": 5000000,
    },
}


async def main():
    # ----------------------------------------------------------------
    # Step 1: Create provider
    # ----------------------------------------------------------------
    provider = WalletFactory(secrets_dir=SECRETS_DIR, password=PASSWORD)
    wallet = await provider.get_wallet(WALLET_ID)
    address = await wallet.get_address()
    print(f"Wallet:  {WALLET_ID}")
    print(f"Address: {address}")
    print()

    # ----------------------------------------------------------------
    # Step 2: Sign x402 PaymentPermit (no "version" in domain)
    # ----------------------------------------------------------------
    print("=== x402 PaymentPermit ===")
    print(f"  Domain:      {PAYMENT_PERMIT['domain']['name']}")
    print(f"  Chain ID:    {PAYMENT_PERMIT['domain']['chainId']}")
    print(f"  Buyer:       {PAYMENT_PERMIT['message']['buyer']}")
    print(f"  Amount:      {PAYMENT_PERMIT['message']['amount']}")

    sig1 = await wallet.sign_typed_data(PAYMENT_PERMIT)
    print(f"  Signature:   {sig1}")
    print()

    # ----------------------------------------------------------------
    # Step 3: Sign standard EIP-712 (with "version" in domain)
    # ----------------------------------------------------------------
    print("=== Standard EIP-712 Transfer ===")
    print(f"  Domain:      {STANDARD_TYPED_DATA['domain']['name']} v{STANDARD_TYPED_DATA['domain']['version']}")
    print(f"  To:          {STANDARD_TYPED_DATA['message']['to']}")
    print(f"  Amount:      {STANDARD_TYPED_DATA['message']['amount']}")

    sig2 = await wallet.sign_typed_data(STANDARD_TYPED_DATA)
    print(f"  Signature:   {sig2}")
    print()

    # ----------------------------------------------------------------
    # Step 4: Verify signature (optional — shows how to recover signer)
    # ----------------------------------------------------------------
    print("=== Verify Signature ===")
    from eth_account import Account
    from eth_account.messages import encode_typed_data
    import base58

    signable = encode_typed_data(full_message=PAYMENT_PERMIT)
    recovered = Account.recover_message(signable, signature=bytes.fromhex(sig1))
    print(f"  Recovered:   {recovered}")

    # Tron address = base58check(0x41 + eth_addr), so decode and extract eth addr for comparison
    tron_bytes = base58.b58decode_check(address)  # 0x41 + 20-byte eth addr
    eth_addr_from_tron = "0x" + tron_bytes[1:].hex()
    print(f"  ETH addr:    {eth_addr_from_tron}")
    print(f"  Matches:     {recovered.lower() == eth_addr_from_tron.lower()}")


if __name__ == "__main__":
    asyncio.run(main())
