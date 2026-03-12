"""
Demo: Sign a BSC (BNB Smart Chain) transaction and broadcast it using agent-wallet SDK.

This example shows how to use the agent-wallet SDK to:
  1. Initialize via WalletFactory (decrypt keys once)
  2. Get an EVM wallet by ID
  3. Sign a message (pure local, no network)
  4. Build a BNB transfer tx, sign it with the SDK, and broadcast via BSC testnet RPC

Prerequisites:
  - agent-wallet init (create secrets dir + master password)
  - agent-wallet add  (add an evm_local wallet, e.g. "wallet-evm")
  - The wallet address must have testnet BNB (use https://www.bnbchain.org/en/testnet-faucet)

Usage:
  AGENT_WALLET_PASSWORD=<your-password> python examples/bsc_sign_and_broadcast.py
"""

import asyncio

import httpx
from eth_utils import to_checksum_address

from agent_wallet import WalletFactory

# --- Configuration ---

# Transfer parameters
TO_ADDRESS = "0x565d490806a6d8ef532f4d29ec00ef6aac71a17a"  # replace with recipient
AMOUNT_WEI = 1_000_000_000_000_000  # 0.001 BNB

# BSC testnet RPC
BSC_TESTNET_RPC = "https://data-seed-prebsc-1-s1.binance.org:8545"
CHAIN_ID = 97  # BSC testnet


async def main():
    # ----------------------------------------------------------------
    # Step 1: Create provider from env and resolve the active wallet
    # ----------------------------------------------------------------
    provider = WalletFactory()

    # ----------------------------------------------------------------
    # Step 2: Get wallet instance
    # ----------------------------------------------------------------
    wallet = await provider.get_active_wallet()
    address = await wallet.get_address()
    print(f"Address:      {address}")
    print()

    # ----------------------------------------------------------------
    # Step 3: Sign a message (pure local, no network)
    # ----------------------------------------------------------------
    message = b"Hello from agent-wallet on BSC!"
    msg_sig = await wallet.sign_message(message)
    print(f"Message signature: {msg_sig}")
    print()

    # ----------------------------------------------------------------
    # Step 4: Build tx, sign with SDK, and broadcast
    #
    # For EVM chains, sign_transaction accepts a standard tx dict with
    # fields like to, value, gas, gasPrice, nonce, chainId.
    # The caller is responsible for fetching nonce & gas prices from RPC.
    # ----------------------------------------------------------------
    print(f"Signing BNB transfer: {AMOUNT_WEI} wei -> {TO_ADDRESS}")
    print(f"Network: BSC testnet (chainId={CHAIN_ID})")
    print()

    async with httpx.AsyncClient() as client:
        # 5a. Get nonce
        nonce = await eth_get_nonce(client, address)
        print(f"Nonce: {nonce}")

        # 5b. Get gas price
        gas_price = await eth_get_gas_price(client)
        print(f"Gas price: {gas_price}")

        # 5c. Build unsigned tx
        tx = {
            "to": to_checksum_address(TO_ADDRESS),
            "value": AMOUNT_WEI,
            "gas": 21000,
            "gasPrice": gas_price,
            "nonce": nonce,
            "chainId": CHAIN_ID,
        }

        # 5d. Sign with agent-wallet SDK
        signed_raw_hex = await wallet.sign_transaction(tx)
        print(f"Signed raw tx: 0x{signed_raw_hex[:40]}...")
        print()

        # 5e. Broadcast
        print("Broadcasting...")
        tx_hash = await eth_send_raw_transaction(client, signed_raw_hex)
        print(f"Broadcasted! tx hash: {tx_hash}")
        print(f"Explorer: https://testnet.bscscan.com/tx/{tx_hash}")


# --- Helper functions (caller's responsibility, NOT part of SDK) ---


async def eth_rpc(client: httpx.AsyncClient, method: str, params: list) -> dict:
    """Send a JSON-RPC request to the BSC testnet node."""
    res = await client.post(
        BSC_TESTNET_RPC,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        },
    )
    data = res.json()
    if "error" in data:
        raise RuntimeError(f"RPC error: {data['error']}")
    return data


async def eth_get_nonce(client: httpx.AsyncClient, address: str) -> int:
    """Get the transaction count (nonce) for an address."""
    data = await eth_rpc(client, "eth_getTransactionCount", [address, "pending"])
    return int(data["result"], 16)


async def eth_get_gas_price(client: httpx.AsyncClient) -> int:
    """Get the current gas price."""
    data = await eth_rpc(client, "eth_gasPrice", [])
    return int(data["result"], 16)


async def eth_send_raw_transaction(client: httpx.AsyncClient, signed_raw_hex: str) -> str:
    """Broadcast a signed raw transaction and return the tx hash."""
    raw = signed_raw_hex if signed_raw_hex.startswith("0x") else f"0x{signed_raw_hex}"
    data = await eth_rpc(client, "eth_sendRawTransaction", [raw])
    return data["result"]


if __name__ == "__main__":
    asyncio.run(main())
