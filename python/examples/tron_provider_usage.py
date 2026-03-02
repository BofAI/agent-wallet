import argparse
import asyncio
import hashlib
import os
import sys
from pathlib import Path

# Ensure `python/` directory is on sys.path when running as a script:
# `python examples/tron_provider_usage.py ...` sets sys.path[0] to `python/examples`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wallet import TronProvider


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="TronProvider usage example (offline-safe)")
    p.add_argument(
        "message",
        help="Message to sign. For --encoding hex, provide hex string (no 0x).",
    )
    p.add_argument(
        "--encoding",
        choices=["utf8", "hex"],
        default="utf8",
        help="How to parse the message input (default: utf8).",
    )
    p.add_argument(
        "--keystore-path",
        default=os.getenv("KEYSTORE_PATH"),
        help="Keystore file path (default: $KEYSTORE_PATH or ~/.agent_wallet/Keystore).",
    )
    p.add_argument(
        "--private-key",
        default=os.getenv("TRON_PRIVATE_KEY"),
        help="Optional private key hex (overrides keystore). Default: $TRON_PRIVATE_KEY.",
    )
    return p.parse_args()


async def main() -> int:
    args = _parse_args()

    msg_bytes = (
        bytes.fromhex(args.message) if args.encoding == "hex" else args.message.encode("utf-8")
    )
    # Design: TronProvider.sign_message expects a 32-byte hash input.
    msg_hash = hashlib.sha256(msg_bytes).digest()

    # Keystore initialization (file creation / writing privateKey) is done via CLI.
    # This provider will only read existing keystore data in the constructor.
    provider = TronProvider(
        private_key=args.private_key,
        keystore_path=args.keystore_path,
    )
    await provider.init()  # compatibility no-op; safe to keep

    info = await provider.get_account_info()
    sig = await provider.sign_message(msg_hash)

    print("address:", info["address"])
    print("message_sha256:", msg_hash.hex())
    print("signature:", sig)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

