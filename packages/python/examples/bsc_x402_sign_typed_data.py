"""
Demo: Sign EIP-712 typed data for x402 payment permit with an EVM/BSC wallet.

This example is the EVM/BSC counterpart to tron_x402_sign_typed_data.py.
It resolves the active wallet from environment variables via WalletFactory()
and verifies the recovered signer directly against the EVM address.

Recommended env:
  EVM_PRIVATE_KEY=<hex> python examples/bsc_x402_sign_typed_data.py
  EVM_MNEMONIC="<words>" python examples/bsc_x402_sign_typed_data.py

Optional local mode also works:
  AGENT_WALLET_PASSWORD=<password> python examples/bsc_x402_sign_typed_data.py
"""

import asyncio

from eth_account import Account
from eth_account.messages import encode_typed_data

from agent_wallet import WalletFactory

# --- x402 PaymentPermit typed data (BSC example) ---

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
        "chainId": 97,  # BSC testnet
        "verifyingContract": "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
    },
    "message": {
        "buyer": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "amount": 1000000,
        "nonce": 0,
    },
}

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
        "chainId": 97,
        "verifyingContract": "0x1234567890abcdef1234567890abcdef12345678",
    },
    "message": {
        "to": "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
        "amount": 5000000,
    },
}


async def main():
    provider = WalletFactory()
    wallet = await provider.get_active_wallet()
    address = await wallet.get_address()

    if not address.startswith("0x"):
        raise RuntimeError(
            "bsc_x402_sign_typed_data.py expects an EVM wallet. "
            "Set EVM_PRIVATE_KEY or EVM_MNEMONIC."
        )

    print(f"Address: {address}")
    print()

    print("=== x402 PaymentPermit (BSC) ===")
    print(f"  Domain:      {PAYMENT_PERMIT['domain']['name']}")
    print(f"  Chain ID:    {PAYMENT_PERMIT['domain']['chainId']}")
    print(f"  Buyer:       {PAYMENT_PERMIT['message']['buyer']}")
    print(f"  Amount:      {PAYMENT_PERMIT['message']['amount']}")

    sig1 = await wallet.sign_typed_data(PAYMENT_PERMIT)
    print(f"  Signature:   {sig1}")
    print()

    print("=== Standard EIP-712 Transfer ===")
    print(
        f"  Domain:      {STANDARD_TYPED_DATA['domain']['name']} "
        f"v{STANDARD_TYPED_DATA['domain']['version']}"
    )
    print(f"  To:          {STANDARD_TYPED_DATA['message']['to']}")
    print(f"  Amount:      {STANDARD_TYPED_DATA['message']['amount']}")

    sig2 = await wallet.sign_typed_data(STANDARD_TYPED_DATA)
    print(f"  Signature:   {sig2}")
    print()

    print("=== Verify Signature ===")
    signable = encode_typed_data(full_message=PAYMENT_PERMIT)
    recovered = Account.recover_message(signable, signature=bytes.fromhex(sig1))
    print(f"  Recovered:   {recovered}")
    print(f"  Matches:     {recovered.lower() == address.lower()}")


if __name__ == "__main__":
    asyncio.run(main())
