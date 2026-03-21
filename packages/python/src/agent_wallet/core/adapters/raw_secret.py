"""Local signer backed by raw secret material stored in config."""

from __future__ import annotations

from agent_wallet.core.adapters.local import LocalSigner
from agent_wallet.core.config import RawSecretMnemonicParams, RawSecretPrivateKeyParams
from agent_wallet.core.providers.wallet_builder import (
    decode_private_key,
    derive_key_from_mnemonic,
    parse_network_family,
)


class RawSecretSigner(LocalSigner):
    """Local signer backed by raw secret material stored in config."""

    def __init__(
        self,
        params: RawSecretPrivateKeyParams | RawSecretMnemonicParams,
        network: str,
    ) -> None:
        family = parse_network_family(network)
        if isinstance(params, RawSecretPrivateKeyParams):
            private_key = decode_private_key(params.private_key)
        elif isinstance(params, RawSecretMnemonicParams):
            private_key = derive_key_from_mnemonic(
                family, params.mnemonic, params.account_index
            )
        else:
            raise ValueError("raw_secret wallets require valid raw secret params")
        super().__init__(private_key=private_key, network=network)
