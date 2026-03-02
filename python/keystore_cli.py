#!/usr/bin/env python3
"""
Keystore CLI: read/write keystore storage.

Usage:
  python -m keystore_cli read [key]
  python -m keystore_cli write <key> <value>
  python -m keystore_cli delete <key>
  python -m keystore_cli init

Options:
  --path <file>    Keystore file path (default: ./.keystore.json)
"""
import argparse
import os
import sys
from pathlib import Path

# Allow running from repo root or from python/
sys.path.insert(0, str(Path(__file__).resolve().parent))

from keystore import Keystore


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Keystore CLI - read/write keystore storage",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
  read [key]       Read one key or all keys
  write <key> <value>  Write one key
  delete <key>     Delete one key
  init             Create empty keystore file
        """,
    )
    parser.add_argument(
        "--path",
        default=os.environ.get("KEYSTORE_PATH", str(Path.home() / ".agent_wallet" / "Keystore")),
        help="Keystore file path",
    )
    parser.add_argument("command", nargs="?", choices=["read", "write", "delete", "init"], help="Command")
    parser.add_argument("args", nargs="*", help="Key and/or value")
    parsed = parser.parse_args()

    cmd = (parsed.command or "").lower()
    args = parsed.args or []
    file_path = parsed.path

    ks = Keystore(file_path=file_path)

    if not cmd:
        parser.print_help()
        sys.exit(0)

    try:
        if cmd == "read":
            ks.read()
            key = args[0] if args else None
            if key:
                value = ks.get(key)
                if value is None:
                    print(f"Key not found: {key}", file=sys.stderr)
                    sys.exit(1)
                print(value)
            else:
                import json
                print(json.dumps(ks.get_all(), indent=2, ensure_ascii=False))

        elif cmd == "write":
            if len(args) < 2:
                print("Usage: write <key> <value>", file=sys.stderr)
                sys.exit(1)
            key, value = args[0], " ".join(args[1:]).strip().strip("'\"")
            ks.read()
            ks.set(key, value)
            ks.write()
            print(f"Written: {key}")

        elif cmd == "delete":
            if not args:
                print("Usage: delete <key>", file=sys.stderr)
                sys.exit(1)
            key = args[0]
            ks.read()
            data = ks.get_all()
            if key not in data:
                print(f"Key not found: {key}", file=sys.stderr)
                sys.exit(1)
            del data[key]
            Keystore.to_file(file_path, data)
            print(f"Deleted: {key}")

        elif cmd == "init":
            if os.path.isfile(file_path):
                print(f"File already exists: {file_path}", file=sys.stderr)
                sys.exit(1)
            Keystore.to_file(file_path, {})
            print(f"Created: {file_path}")

    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
