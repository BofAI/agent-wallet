"""
Demo: Switch active wallet via the agent-wallet SDK.

This example shows how to use the active wallet feature programmatically:
  1. Resolve a ConfigWalletProvider
  2. List all wallets and show which one is active
  3. Switch the active wallet
  4. Sign a message using the active wallet (no wallet ID needed)

Prerequisites:
  - agent-wallet init
  - agent-wallet add  (add at least two wallets)

Usage:
  AGENT_WALLET_PASSWORD=<your-password> python examples/switch_active_wallet.py
"""

import asyncio
import os

from agent_wallet import ConfigWalletProvider, resolve_wallet_provider

# --- Configuration ---

SECRETS_DIR = os.environ.get("AGENT_WALLET_DIR", os.path.expanduser("~/.agent-wallet"))
NETWORK = os.environ.get("AGENT_WALLET_NETWORK", "eip155")


async def main():
    # ----------------------------------------------------------------
    # Step 1: Resolve config-backed provider
    # ----------------------------------------------------------------
    provider = resolve_wallet_provider(dir=SECRETS_DIR, network=NETWORK)
    if not isinstance(provider, ConfigWalletProvider):
        raise RuntimeError(
            "switch_active_wallet.py requires a config-backed wallet directory."
        )

    # ----------------------------------------------------------------
    # Step 2: List wallets and show current active wallet
    # ----------------------------------------------------------------
    wallets = provider.list_wallets()
    active_id = provider.get_active_id()

    print("Available wallets:")
    for wallet_id, conf, is_active in wallets:
        marker = " *" if is_active else ""
        print(f"  - {wallet_id} ({conf.type}){marker}")
    print(f"\nActive wallet: {active_id or '(none)'}")
    print()

    # ----------------------------------------------------------------
    # Step 3: Sign a message using the active wallet (no ID needed)
    # ----------------------------------------------------------------
    if active_id:
        wallet = await provider.get_active_wallet()
        address = await wallet.get_address()
        sig = await wallet.sign_message(b"Hello from active wallet!")
        print(f"Signed with active wallet '{active_id}':")
        print(f"  Address:   {address}")
        print(f"  Signature: {sig}")
        print()

    # ----------------------------------------------------------------
    # Step 4: Switch active wallet
    # ----------------------------------------------------------------
    if len(wallets) < 2:
        print("Add at least 2 wallets to demo switching.")
        return

    # Pick a wallet that is NOT the current active one
    new_active = next(wallet_id for wallet_id, _conf, _is_active in wallets if wallet_id != active_id)
    provider.set_active(new_active)
    print(f"Switched active wallet to '{new_active}'")
    print()

    # ----------------------------------------------------------------
    # Step 5: Sign again with the new active wallet
    # ----------------------------------------------------------------
    wallet = await provider.get_active_wallet()
    address = await wallet.get_address()
    sig = await wallet.sign_message(b"Hello from active wallet!")
    print(f"Signed with new active wallet '{new_active}':")
    print(f"  Address:   {address}")
    print(f"  Signature: {sig}")


if __name__ == "__main__":
    asyncio.run(main())
