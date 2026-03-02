import asyncio
import os
import tempfile

import sys
from pathlib import Path

# Ensure `python/` directory is on sys.path when running as a script.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from keystore import Keystore
from wallet import TronProvider, FlashProvider


class LocalTronProvider(TronProvider):
    """Local-only provider that overrides network methods."""

    async def get_balance(self, address=None) -> float:
        return 123.456

    async def get_trc20_balance(self, wallet_address: str, contract_address: str) -> int:
        return 1000000

    async def send_transaction(self, to_address: str, amount: float) -> dict:
        return {"result": True, "txid": "LOCAL_TXID"}

    async def broadcast_transaction(self, signed_transaction) -> dict:
        return {"result": True, "txid": "LOCAL_BROADCAST_TXID"}

    async def sign_transaction(self, transaction):
        # Local stub: attach a signature by signing a message derived from txid/txID
        txid = getattr(transaction, "txid", None) or getattr(transaction, "txID", None) or "tx-demo"
        sig = await self.sign_message(str(txid).encode("utf-8"))
        transaction._signature = [sig]
        return transaction


class LocalFlashProvider(FlashProvider):
    async def send_transaction(self, to_address: str, amount: float) -> dict:
        return {"result": True, "txid": "LOCAL_FLASH_TXID"}


async def main() -> int:
    tmp_path = os.path.join(tempfile.gettempdir(), f"agent-wallet-keystore-{os.getpid()}.bin")

    # ===== Keystore (all methods) =====
    ks = Keystore(file_path=tmp_path)
    print("[keystore] path:", ks.get_path())
    ks.read()
    ks.set("privateKey", "11" * 32)  # demo-only key, do not use in production
    ks.write()
    print("[keystore] keys:", sorted(ks.keys()))
    print("[keystore] privateKey len:", len(ks.get("privateKey") or ""))
    print("[keystore] all:", ks.get_all())
    snap = Keystore.from_file(tmp_path)
    print("[keystore] from_file:", snap)
    Keystore.to_file(tmp_path, {**snap, "note": "updated by to_file"})

    # ===== TronProvider (all methods, local stubs) =====
    tron = LocalTronProvider(keystore_path=tmp_path)
    await tron.init()
    print("[tron] account:", await tron.get_account_info())
    print("[tron] sign_message:", await tron.sign_message(b"hello"))
    # stub transaction object
    class Tx:
        txid = "tx-demo"
    signed_tx = await tron.sign_transaction(Tx())
    print("[tron] sign_transaction:", getattr(signed_tx, "_signature", None))
    print("[tron] balance:", await tron.get_balance())
    print("[tron] trc20 balance:", await tron.get_trc20_balance("wallet", "contract"))
    print("[tron] send_transaction:", await tron.send_transaction("recipient", 1.0))
    print("[tron] broadcast_transaction:", await tron.broadcast_transaction(signed_tx))

    # ===== FlashProvider (all methods, local stubs) =====
    flash = LocalFlashProvider(
        keystore_path=tmp_path,
        # keep privy creds unset so it falls back to local signing if used
        privy_app_id=None,
        privy_app_secret=None,
        wallet_id=None,
    )
    await flash.init()
    print("[flash] sign_message:", await flash.sign_message(b"hello"))
    print("[flash] send_transaction:", await flash.send_transaction("recipient", 2.0))

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

