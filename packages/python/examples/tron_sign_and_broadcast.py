"""
Demo: Sign a TRON transaction and broadcast it using agent-wallet SDK.

This example shows how mcp-server-tron (or any other integration) can use
the agent-wallet SDK to:
  1. Initialize via WalletFactory (decrypt keys once)
  2. Get a wallet by ID
  3. Sign a message (pure local, no network)
  4. Build an unsigned tx via TronGrid, sign it with the SDK, and broadcast

The SDK is signing-only. The caller is responsible for building transactions
(via TronGrid / TronWeb) and broadcasting them.

Prerequisites:
  - agent-wallet init (create secrets dir + master password)
  - agent-wallet add  (add a tron_local wallet, e.g. "wallet-b")
  - The wallet address must be activated (have received TRX at least once)

Usage:
  AGENT_WALLET_PASSWORD=<your-password> python examples/tron_sign_and_broadcast.py
"""

import asyncio
import json

import httpx

from agent_wallet import WalletFactory

# --- Configuration ---

# Transfer parameters
TO_ADDRESS = "TVDGpn4hCSzJ5nkHPLetk8KQBtwaTppnkr"
AMOUNT_SUN = 1_000_000  # 1 TRX = 1,000,000 SUN

# TronGrid endpoints by network
TRONGRID_URLS = {
    "mainnet": "https://api.trongrid.io",
    "nile": "https://nile.trongrid.io",
    "shasta": "https://api.shasta.trongrid.io",
}


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
    message = b"Hello from agent-wallet!"
    msg_sig = await wallet.sign_message(message)
    print(f"Message signature: {msg_sig}")
    print()

    # ----------------------------------------------------------------
    # Step 4: Build unsigned tx via TronGrid, then sign with SDK
    #
    # The caller builds the transaction using TronGrid's REST API.
    # The SDK only signs: it takes the unsigned tx { txID, raw_data_hex }
    # and returns a signed tx JSON with the signature attached.
    # ----------------------------------------------------------------
    network = "nile"
    base_url = TRONGRID_URLS.get(network, TRONGRID_URLS["nile"])

    print(f"Signing TRX transfer: {AMOUNT_SUN} SUN -> {TO_ADDRESS}")
    print(f"Network: {network} ({base_url})")

    # 5a. Caller builds unsigned tx via TronGrid
    unsigned_tx = await build_trx_transfer(base_url, address, TO_ADDRESS, AMOUNT_SUN)
    print(f"TX ID:     {unsigned_tx['txID']}")

    # 5b. SDK signs the unsigned tx
    signed_tx_json = await wallet.sign_transaction(unsigned_tx)
    signed_tx = json.loads(signed_tx_json)
    print(f"Signature: {signed_tx['signature'][0]}")
    print()

    # ----------------------------------------------------------------
    # Step 5: Caller broadcasts the signed tx
    # ----------------------------------------------------------------
    print("Broadcasting...")
    txid = await broadcast_transaction(signed_tx, base_url)
    print(f"Broadcasted! txid: {txid}")

    explorer_base = (
        "https://tronscan.org" if network == "mainnet"
        else f"https://{network}.tronscan.org"
    )
    print(f"Explorer:   {explorer_base}/#/transaction/{txid}")


# --- Helper functions (caller's responsibility, NOT part of SDK) ---


async def build_trx_transfer(
    base_url: str, from_addr: str, to_addr: str, amount_sun: int
) -> dict:
    """Build an unsigned TRX transfer via TronGrid REST API."""
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{base_url}/wallet/createtransaction",
            json={
                "owner_address": from_addr,
                "to_address": to_addr,
                "amount": amount_sun,
                "visible": True,
            },
        )
        tx = res.json()
        if "txID" not in tx:
            raise RuntimeError(f"Failed to build transaction: {tx}")
        return tx


async def broadcast_transaction(signed_tx: dict, base_url: str) -> str:
    """Broadcast a signed transaction to the TRON network."""
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{base_url}/wallet/broadcasttransaction",
            json=signed_tx,
        )
        result = res.json()
        if result.get("result"):
            return result.get("txid", signed_tx.get("txID", ""))
        raise RuntimeError(f"Broadcast rejected: {result}")


if __name__ == "__main__":
    asyncio.run(main())
