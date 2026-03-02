from typing import Optional, Any
from tronpy import AsyncTron
from tronpy.keys import PrivateKey
from tronpy.providers import AsyncHTTPProvider
from dotenv import load_dotenv

from wallet.base_provider import BaseProvider
from wallet.types import AccountInfo, SignedTxResult

load_dotenv()

DEFAULT_TRON_RPC_URL = "https://api.trongrid.io"


class TronProvider(BaseProvider):
    def __init__(
        self,
        private_key: Optional[str] = None,
        keystore_path: Optional[str] = None,
        keystore=None,
    ):
        """Initialize the TronProvider (credentials are read from keystore in constructor)."""
        super().__init__(
            keystore_path=keystore_path,
            keystore=keystore,
        )

        # RPC URL is fixed for TronProvider (not configurable).
        self._rpc_url = DEFAULT_TRON_RPC_URL
        # private_key comes from keystore (or explicit args), not from env.
        self._private_key_hex: Optional[str] = private_key
        self._key: Optional[PrivateKey] = None
        self.address: Optional[str] = None
        self.client: Optional[AsyncTron] = None

        # Load missing credentials from keystore (already read by BaseProvider).
        # Keystore keys used: privateKey
        ks_private_key = self.keystore.get("privateKey")

        if not self._private_key_hex and ks_private_key:
            self._private_key_hex = ks_private_key

        self._build_client()

    def _build_client(self) -> None:
        """Build / rebuild the Tron client from current credentials."""
        provider = AsyncHTTPProvider(self._rpc_url)
        self.client = AsyncTron(provider=provider)

        if self._private_key_hex:
            try:
                self._key = PrivateKey(bytes.fromhex(self._private_key_hex))
                self.address = self._key.public_key.to_base58check_address()
            except Exception:
                print("Warning: Invalid private key provided")
                self._key = None
                self.address = None
        else:
            self._key = None
            self.address = None

    async def init(self) -> "TronProvider":
        """Compatibility no-op (credentials are loaded in constructor)."""
        await super().init()
        return self

    @classmethod
    async def create(
        cls,
        private_key: Optional[str] = None,
        keystore_path: Optional[str] = None,
        keystore=None,
    ) -> "TronProvider":
        """Factory: create and init a TronProvider in one step."""
        provider = cls(
            private_key=private_key,
            keystore_path=keystore_path,
            keystore=keystore,
        )
        await provider.init()
        return provider

    async def get_account_info(self) -> AccountInfo:
        """Get account info (wallet address). BaseProvider compatibility."""
        if not self.address:
            raise ValueError("Address not available (no private key or wallet id)")
        return {"address": self.address}

    async def sign_tx(self, unsigned_tx: Any) -> SignedTxResult:
        """Sign unsigned transaction and return signed result. BaseProvider compatibility."""
        signed = await self.sign_transaction(unsigned_tx)
        sig = getattr(signed, "_signature", None) or getattr(signed, "signature", None)
        if isinstance(sig, list) and len(sig) > 0:
            raw_sig = sig[0]
            signature = raw_sig if isinstance(raw_sig, str) else None
        else:
            signature = None
        return {"signed_tx": signed, "signature": signature}

    async def sign_message(self, message: bytes) -> str:
        """Sign an arbitrary message (bytes) and return a raw signature hex string."""
        return self._sign_message(message)

    def _sign_message(self, message: bytes) -> str:
        """Sync helper for message signing."""
        if not self._key:
            raise ValueError("Private key not provided for signing")
        # Design: sign_message expects a 32-byte message hash.
        # tronpy's sign_msg_hash() requires a 32-byte input.
        sig = self._key.sign_msg_hash(message)
        return sig.hex()

    async def get_balance(self, address: Optional[str] = None) -> float:
        """Get TRX balance of an address."""
        addr = address or self.address
        if not addr:
            raise ValueError("Address not provided")
        balance = await self.client.get_account_balance(addr)
        return float(balance)

    async def get_trc20_balance(self, wallet_address: str, contract_address: str) -> int:
        """Get TRC20 token balance."""
        contract = await self.client.get_contract(contract_address)
        balance = await contract.functions.balanceOf(wallet_address)
        return int(balance)

    async def send_transaction(self, to_address: str, amount: float) -> dict:
        """Send TRX to an address."""
        txn = (
            self.client.trx.transfer(self.address, to_address, amount)
            .memo("Powered by Agent Wallet")
            .fee_limit(100_000_000)
        )
        txn = await txn.build()
        signed_txn = await self.sign_transaction(txn)
        result = await signed_txn.broadcast()
        return result

    async def sign_transaction(self, transaction: Any) -> Any:
        """Sign a transaction object."""
        if not self._key:
            raise ValueError("Private key not provided for signing")
        return transaction.sign(self._key)

    async def broadcast_transaction(self, signed_transaction: Any) -> dict:
        """Broadcast a signed transaction."""
        return await signed_transaction.broadcast()
