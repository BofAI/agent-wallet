"""
Demo: Create wallet providers using `create_wallet_provider` with explicit options.

This example shows all four modes of `create_wallet_provider`:

  1. Private key mode  — pass a PrivateKeyProviderOptions
  2. Mnemonic mode     — pass a MnemonicProviderOptions (+ optional account index)
  3. Local mode        — pass a LocalProviderOptions with password
  4. Env fallback mode — no explicit credentials, reads from environment variables

Usage:
  PRIVATE_KEY=<hex> python examples/create_wallet_provider.py
  MNEMONIC="<words>" python examples/create_wallet_provider.py
  MNEMONIC="<words>" MNEMONIC_ACCOUNT_INDEX=1 python examples/create_wallet_provider.py
  WALLET_PASSWORD=<password> python examples/create_wallet_provider.py
"""

from __future__ import annotations

import asyncio
import os

from agent_wallet import (
    LocalProviderOptions,
    MnemonicProviderOptions,
    PrivateKeyProviderOptions,
    create_wallet_provider,
)


async def print_wallet(label: str, provider) -> None:
    wallet = await provider.get_active_wallet()
    address = await wallet.get_address()

    print(f"=== {label} ===")
    print(f"Address: {address}")
    print()


async def main():
    private_key = os.environ.get("PRIVATE_KEY", "").strip()
    mnemonic = os.environ.get("MNEMONIC", "").strip()
    wallet_password = os.environ.get("WALLET_PASSWORD", "").strip()
    account_index = int(os.environ.get("MNEMONIC_ACCOUNT_INDEX", "0").strip() or "0")
    configured_modes = sum(bool(v) for v in (private_key, mnemonic, wallet_password))

    if configured_modes > 1:
        raise RuntimeError("Set only one of PRIVATE_KEY, MNEMONIC, or WALLET_PASSWORD.")
    if configured_modes == 0:
        raise RuntimeError(
            "Set PRIVATE_KEY, MNEMONIC, or WALLET_PASSWORD before running this example."
        )

    # --- Build providers using create_wallet_provider with explicit options ---

    if private_key:
        print("Mode: privateKey\n")

        tron_provider = create_wallet_provider(
            PrivateKeyProviderOptions(private_key=private_key, network="tron")
        )
        evm_provider = create_wallet_provider(
            PrivateKeyProviderOptions(private_key=private_key, network="eip155")
        )

        await print_wallet("TRON", tron_provider)
        await print_wallet("EVM", evm_provider)

    elif mnemonic:
        print(f"Mode: mnemonic (account_index={account_index})\n")

        tron_provider = create_wallet_provider(
            MnemonicProviderOptions(
                mnemonic=mnemonic, network="tron", account_index=account_index
            )
        )
        evm_provider = create_wallet_provider(
            MnemonicProviderOptions(
                mnemonic=mnemonic, network="eip155", account_index=account_index
            )
        )

        await print_wallet("TRON", tron_provider)
        await print_wallet("EVM", evm_provider)

    else:
        print("Mode: local (password)\n")

        provider = create_wallet_provider(
            LocalProviderOptions(password=wallet_password)
        )

        await print_wallet("Local", provider)


if __name__ == "__main__":
    asyncio.run(main())
