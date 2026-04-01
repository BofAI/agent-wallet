"""Local signer facade — dispatches to EVM or TRON signer by network."""

from __future__ import annotations

from agent_wallet.core.base import Eip712Capable, Network, SignOptions, Wallet
from agent_wallet.core.errors import UnsupportedOperationError
from agent_wallet.core.utils.network import parse_network_family


class LocalSigner(Wallet, Eip712Capable):
    """Wallet facade that dispatches to an EVM or TRON signer by network."""

    def __init__(self, private_key: bytes, network: str | None) -> None:
        self._network = network or ""
        self._impl = _create_signer(private_key, network)

    async def get_address(self) -> str:
        return await self._impl.get_address()

    async def sign_raw(self, raw_tx: bytes, options: SignOptions | None = None) -> str:
        return await self._impl.sign_raw(raw_tx, options)

    async def sign_transaction(self, payload: dict, options: SignOptions | None = None) -> str:
        return await self._impl.sign_transaction(payload, options)

    async def sign_message(self, msg: bytes, options: SignOptions | None = None) -> str:
        return await self._impl.sign_message(msg, options)

    async def sign_typed_data(self, data: dict, options: SignOptions | None = None) -> str:
        impl = self._impl
        if not isinstance(impl, Eip712Capable):
            raise UnsupportedOperationError(
                f"Wallet for network '{self._network}' does not support EIP-712 signing."
            )
        return await impl.sign_typed_data(data, options)


def _create_signer(private_key: bytes, network: str | None) -> Wallet:
    family = parse_network_family(network)
    if family == Network.EVM:
        from agent_wallet.core.adapters.evm import EvmSigner

        return EvmSigner(private_key=private_key, network=network)
    if family == Network.TRON:
        from agent_wallet.core.adapters.tron import TronSigner

        return TronSigner(private_key=private_key, network=network)
    raise ValueError(f"Unknown network: {network}")
