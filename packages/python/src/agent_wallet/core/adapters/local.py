"""Local signer facade — dispatches to EVM or TRON signer by network."""

from __future__ import annotations

from agent_wallet.core.base import Eip712Capable, Network, Wallet
from agent_wallet.core.errors import UnsupportedOperationError
from agent_wallet.core.providers.wallet_builder import parse_network_family


class LocalSigner(Wallet, Eip712Capable):
    """Wallet facade that dispatches to an EVM or TRON signer by network."""

    def __init__(self, private_key: bytes, network: str) -> None:
        self._network = network
        self._impl = _create_signer(private_key, network)

    async def get_address(self) -> str:
        return await self._impl.get_address()

    async def sign_raw(self, raw_tx: bytes) -> str:
        return await self._impl.sign_raw(raw_tx)

    async def sign_transaction(self, payload: dict) -> str:
        return await self._impl.sign_transaction(payload)

    async def sign_message(self, msg: bytes) -> str:
        return await self._impl.sign_message(msg)

    async def sign_typed_data(self, data: dict) -> str:
        impl = self._impl
        if not isinstance(impl, Eip712Capable):
            raise UnsupportedOperationError(
                f"Wallet for network '{self._network}' does not support EIP-712 signing."
            )
        return await impl.sign_typed_data(data)


def _create_signer(private_key: bytes, network: str) -> Wallet:
    family = parse_network_family(network)
    if family == Network.EVM:
        from agent_wallet.core.adapters.evm import EvmSigner

        return EvmSigner(private_key=private_key, network=network)
    if family == Network.TRON:
        from agent_wallet.core.adapters.tron import TronSigner

        return TronSigner(private_key=private_key, network=network)
    raise ValueError(f"Unknown network: {network}")
