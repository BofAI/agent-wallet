from wallet.tron_provider import TronProvider
from tronpy import AsyncTron
from tronpy.providers import AsyncHTTPProvider
from typing import Optional, Any
import httpx
import os
import json


class FlashProvider(TronProvider):
    def __init__(
        self,
        privy_app_id: Optional[str] = None,
        privy_app_secret: Optional[str] = None,
        wallet_id: Optional[str] = None,
        keystore_path: Optional[str] = None,
        keystore=None,
    ):
        """Initialize FlashProvider with Privy integration (credentials are read from keystore in constructor)."""
        super().__init__(
            private_key=None,
            keystore_path=keystore_path,
            keystore=keystore,
        )

        # privy_app_id/privy_app_secret/wallet_id come from keystore (or explicit args), not from env.
        self.privy_app_id = privy_app_id
        self.privy_app_secret = privy_app_secret
        self.wallet_id = wallet_id

        # Load missing Privy credentials from keystore (already read by BaseProvider).
        # Keystore keys: privyAppId, privyAppSecret, walletId
        ks_privy_app_id = self.keystore.get("privyAppId")
        ks_privy_app_secret = self.keystore.get("privyAppSecret")
        ks_wallet_id = self.keystore.get("walletId")

        if not self.privy_app_id and ks_privy_app_id:
            self.privy_app_id = ks_privy_app_id
        if not self.privy_app_secret and ks_privy_app_secret:
            self.privy_app_secret = ks_privy_app_secret
        if not self.wallet_id and ks_wallet_id:
            self.wallet_id = ks_wallet_id

        if self.wallet_id:
            self.address = self.wallet_id

        if not self.privy_app_id or not self.privy_app_secret or not self.wallet_id:
            print("Warning: Privy credentials (APP_ID, APP_SECRET, WALLET_ID) not fully provided.")

    async def init(self) -> "FlashProvider":
        """Compatibility no-op (credentials are loaded in constructor)."""
        await super().init()
        return self

    @classmethod
    async def create(
        cls,
        privy_app_id: Optional[str] = None,
        privy_app_secret: Optional[str] = None,
        wallet_id: Optional[str] = None,
        keystore_path: Optional[str] = None,
        keystore=None,
    ) -> "FlashProvider":
        """Factory: create and init a FlashProvider in one step."""
        provider = cls(
            privy_app_id=privy_app_id,
            privy_app_secret=privy_app_secret,
            wallet_id=wallet_id,
            keystore_path=keystore_path,
            keystore=keystore,
        )
        await provider.init()
        return provider

    async def sign_transaction(self, transaction: Any) -> Any:
        """Sign transaction using Privy API."""
        tx_id = transaction.txid

        sign_url = f"https://auth.privy.io/api/v1/wallets/{self.wallet_id}/sign"

        headers = {
            "Authorization": f"Basic {self._get_basic_auth()}",
            "Content-Type": "application/json",
            "privy-app-id": self.privy_app_id,
        }

        payload = {
            "method": "raw_sign",
            "params": {"message": tx_id, "encoding": "hex"},
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(sign_url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

            if "signature" not in data:
                raise ValueError("Privy signing response did not contain a signature")
            transaction._signature = [data["signature"]]
            return transaction

    async def sign_message(self, message: bytes) -> str:
        """Sign an arbitrary message and return a raw signature string.

        If Privy credentials are not configured, falls back to local signing
        (same as TronProvider).
        """
        if not self.privy_app_id or not self.privy_app_secret or not self.wallet_id:
            return await super().sign_message(message)

        msg_hex = message.hex()

        sign_url = f"https://auth.privy.io/api/v1/wallets/{self.wallet_id}/sign"
        headers = {
            "Authorization": f"Basic {self._get_basic_auth()}",
            "Content-Type": "application/json",
            "privy-app-id": self.privy_app_id,
        }
        payload = {"method": "raw_sign", "params": {"message": msg_hex, "encoding": "hex"}}

        async with httpx.AsyncClient() as client:
            resp = await client.post(sign_url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            if "signature" not in data:
                raise ValueError("Privy signing response did not contain a signature")
            return data["signature"]

    
    def _get_basic_auth(self) -> str:
        import base64

        creds = f"{self.privy_app_id}:{self.privy_app_secret}"
        return base64.b64encode(creds.encode()).decode()

    async def send_transaction(self, to_address: str, amount: float) -> dict:
        """Send a flash transaction using Privy signing."""
        if not self.address:
            raise ValueError("Address not available for signing")
        txn = (
            self.client.trx.transfer(self.address, to_address, amount)
            .memo("Privy Flash Transaction")
            .fee_limit(100_000_000)
        )
        txn = await txn.build()
        signed_txn = await self.sign_transaction(txn)
        result = await signed_txn.broadcast()
        return result
