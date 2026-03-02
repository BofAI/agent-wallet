from os import getenv
from typing import Optional, Any
from tronpy import AsyncTron
from tronpy.keys import PrivateKey
from tronpy.providers import AsyncHTTPProvider
from dotenv import load_dotenv

load_dotenv()

class TronProvider:
    def __init__(self, rpc_url: Optional[str] = None, private_key: Optional[str] = None, api_key: Optional[str] = None):
        """
        Initialize the TronProvider with RPC URL, Private Key, and API Key.
        :param rpc_url: URL of the TRON RPC node (default: from env or Trongrid)
        :param private_key: Private key in hex format (default: from env)
        :param api_key: TronGrid API Key (default: from env)
        """
        self.rpc_url = rpc_url or getenv("TRON_RPC_URL", "https://api.trongrid.io")
        self._private_key_hex = private_key or getenv("TRON_PRIVATE_KEY")
        self.api_key = api_key or getenv("TRON_GRID_API_KEY")
        
        if self.api_key:
            provider = AsyncHTTPProvider(self.rpc_url, api_key=self.api_key)
        else:
            provider = AsyncHTTPProvider(self.rpc_url)
            
        self.client = AsyncTron(provider=provider)
        
        if self._private_key_hex:
            try:
                self._key = PrivateKey(bytes.fromhex(self._private_key_hex))
                self.address = self._key.public_key.to_base58check_address()
            except Exception as e:
                print(f"Warning: Invalid private key provided: {e}")
                self._key = None
                self.address = None
        else:
            self._key = None
            self.address = None

    async def get_balance(self, address: Optional[str] = None) -> float:
        """
        Get TRX balance of an address.
        :param address: Address to check (default: self.address)
        :return: Balance in TRX (float)
        """
        addr = address or self.address
        if not addr:
            raise ValueError("Address not provided")
        # get_account_balance returns balance in SUN (integer)? No, tronpy usually returns Decimal or float.
        # Actually standard tronpy returns Decimal. Let's return float.
        balance = await self.client.get_account_balance(addr)
        return float(balance)

    async def get_trc20_balance(self, wallet_address: str, contract_address: str) -> int:
        """
        Get TRC20 token balance using contract call.
        :param wallet_address: Address holding the tokens
        :param contract_address: Address of the TRC20 contract
        :return: Balance in smallest unit (raw integer)
        """
        contract = await self.client.get_contract(contract_address)
        # Assuming standard ERC20/TRC20 balanceOf method
        balance = await contract.functions.balanceOf(wallet_address)
        return int(balance)

    async def send_transaction(self, to_address: str, amount: float) -> dict:
        """
        Send TRX to an address.
        :param to_address: Recipient address
        :param amount: Amount in TRX
        :return: Transaction result dict
        """

        
        # build transaction
        txn = (
            self.client.trx.transfer(self.address, to_address, amount)
            .memo("Powered by Agent Wallet")
            .fee_limit(100_000_000)
        )
        # build is async in AsyncTron
        txn = await txn.build()
        # sign
        signed_txn = await self.sign_transaction(txn)
        # broadcast
        result = await signed_txn.broadcast()
        return result

    async def sign_transaction(self, transaction: Any) -> Any:
        """
        Sign a transaction object.
        :param transaction: Transaction object (from tronpy)
        :return: Signed transaction object
        """
        if not self._key:
            raise ValueError("Private key not provided for signing")
        return transaction.sign(self._key)

    async def broadcast_transaction(self, signed_transaction: Any) -> dict:
        """
        Broadcast a signed transaction.
        :param signed_transaction: Signed transaction object
        :return: Broadcast result
        """
        return await signed_transaction.broadcast()
