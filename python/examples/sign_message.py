import os
import sys
import asyncio

from pathlib import Path

# Ensure `python/` directory is on sys.path when running as a script:
# `python examples/sign_message.py ...` sets sys.path[0] to `python/examples`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wallet import TronProvider


def usage() -> None:
    print(
        "\n".join(
            [
                "Usage:",
                '  LOG_LEVEL=INFO TRON_PRIVATE_KEY=... .venv/bin/python examples/sign_message.py "hello" [utf8|hex]',
                "",
                "Notes:",
                "  - If TRON_PRIVATE_KEY is not set, TronProvider will try to load privateKey from keystore (~/.agent_wallet/Keystore).",
                "  - For encoding=hex, the message must be a hex string (no 0x prefix).",
            ]
        )
    )


async def main() -> int:
    if len(sys.argv) < 2:
        usage()
        return 2

    message = sys.argv[1]
    parse_as = sys.argv[2] if len(sys.argv) >= 3 else "utf8"
    if parse_as not in ("utf8", "hex"):
        usage()
        return 2

    message_bytes = bytes.fromhex(message) if parse_as == "hex" else message.encode("utf-8")

    provider = TronProvider(
        private_key=os.getenv("TRON_PRIVATE_KEY"),
        keystore_path=os.getenv("KEYSTORE_PATH"),
    )
    await provider.init()

    sig = await provider.sign_message(message_bytes)
    print(sig)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

