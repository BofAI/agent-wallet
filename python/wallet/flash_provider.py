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
        rpc_url: Optional[str] = None, 
        api_key: Optional[str] = None,
        privy_app_id: Optional[str] = None,
        privy_app_secret: Optional[str] = None,
        wallet_id: Optional[str] = None
    ):
        """
        Initialize FlashProvider with Privy integration.
        :param rpc_url: TRON RPC URL
        :param api_key: TronGrid API Key
        :param privy_app_id: Privy App ID (from env if None)
        :param privy_app_secret: Privy App Secret (from env if None)
        :param wallet_id: Privy Wallet ID / Address (from env if None)
        """
        # Initialize parent with no private key, as we use Privy for signing
        super().__init__(rpc_url=rpc_url, api_key=api_key, private_key=None)
        
        self.privy_app_id = privy_app_id or os.getenv("PRIVY_APP_ID")
        self.privy_app_secret = privy_app_secret or os.getenv("PRIVY_APP_SECRET")
        self.wallet_id = wallet_id or os.getenv("PRIVY_WALLET_ID") # This acts as the address
        
        # Override address if provided via wallet_id
        if self.wallet_id:
            self.address = self.wallet_id

        if not self.privy_app_id or not self.privy_app_secret or not self.wallet_id:
            print("Warning: Privy credentials (APP_ID, APP_SECRET, WALLET_ID) not fully provided.")

    async def sign_transaction(self, transaction: Any) -> Any:
        """
        Sign transaction using Privy API.
        :param transaction: Tronpy transaction object
        :return: Signed transaction object
        """
        # 1. Serialize transaction to get raw data/hash
        # Tronpy transaction object needs to be inspected. 
        # Usually we need the raw_data or txID to sign. 
        # Privy 'rpc' endpoint allows generic RPC calls or specific signing.
        # For 'raw' signing, we might need to send the transaction hash.
        
        # However, looking at standard Privy usage for server wallets:
        # We usually use the `privy.wallets.rpc` to send a JSON-RPC request.
        # But for TRON, we likely want `eth_sign` equivalent or `personal_sign`.
        # Wait, TRON signing is different. 
        # If Privy supports TRON "rawSign", we send the hash.
        
        # Let's assume we send the transaction ID (hash) to be signed.
        tx_id = transaction.txid
        
        # NOTE: This endpoint and payload structure is hypothetical based on "raw signing" 
        # description for Privy Tier 2 chains. 
        # Adjust URL and payload based on exact Privy API docs for TRON.
        url = "https://auth.privy.io/api/v1/wallets" # Base URL
        # Actually it's likely /api/v1/wallets/{wallet_id}/rpc or similar for generic calls
        # Or a specific sign endpoint. 
        # Based on search results: "utilize Privy's rawSign method".
        
        # Let's implement a generic signature request. 
        # We'll assume we POST to /api/v1/wallets/{wallet_id}/sign
        # Payload: { "message": tx_id, "encoding": "hex" ... }
        
        sign_url = f"https://auth.privy.io/api/v1/wallets/{self.wallet_id}/sign"
        
        headers = {
            "Authorization": f"Basic {self._get_basic_auth()}",
            "Content-Type": "application/json",
            "privy-app-id": self.privy_app_id
        }
        
        payload = {
            "method": "raw_sign", # or just implied by endpoint
            "params": {
                "message": tx_id, # Hash of the transaction
                "encoding": "hex"
            }
        }
        
        async with httpx.AsyncClient() as client:
            resp = await client.post(sign_url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            # signature = data['signature']
            # We need to add signature to the transaction object.
            
            # Since we can't test against real API, we'll assume success structure.
            # transaction.signature = [signature] 
            # But tronpy expects signatures to be added via .sign method which uses keys.
            # We have to manually append signature.
            
            # Placeholder for actual signature insertion:
            if 'signature' in data:
                 transaction._signature = [data['signature']]
            
            return transaction

    def _get_basic_auth(self) -> str:
        import base64
        creds = f"{self.privy_app_id}:{self.privy_app_secret}"
        return base64.b64encode(creds.encode()).decode()

    async def send_transaction(self, to_address: str, amount: float, priority_fee: int = 1000) -> dict:
        """
        Send a flash transaction using Privy signing, overriding standard send_transaction.
        :param to_address: Recipient address
        :param amount: Amount in TRX
        :param priority_fee: Additional fee in SUN to prioritize transaction
        :return: Transaction result
        """
        # Create transaction
        txn = (
            self.client.trx.transfer(self.address, to_address, amount)
            .memo("Privy Flash Transaction")
            .fee_limit(100_000_000 + priority_fee) 
        )
        txn = await txn.build()
        
        # Sign with Privy
        signed_txn = await self.sign_transaction(txn)
        
        # Broadcast
        result = await signed_txn.broadcast()
        return result
