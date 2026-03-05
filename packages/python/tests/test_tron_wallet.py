"""Tests for TronWallet — sign/verify roundtrip.

Tron uses the same ECDSA curve (secp256k1) as Ethereum, so we can
cross-verify signatures using both tronpy and eth_account.
"""

import os

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct, encode_typed_data
from tronpy.keys import PrivateKey

from agent_wallet.core.adapters.tron import TronWallet


# Known test private key
TEST_KEY = bytes.fromhex(
    "4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b"
)
TEST_TRON_KEY = PrivateKey(TEST_KEY)
TEST_ADDRESS = TEST_TRON_KEY.public_key.to_base58check_address()


@pytest.fixture
def tron_wallet():
    return TronWallet(private_key=TEST_KEY)


# --- Address ---


@pytest.mark.asyncio
async def test_get_address(tron_wallet):
    addr = await tron_wallet.get_address()
    assert addr == TEST_ADDRESS


@pytest.mark.asyncio
async def test_address_is_base58():
    """Tron address must be base58check format starting with T."""
    key = os.urandom(32)
    wallet = TronWallet(private_key=key)
    addr = await wallet.get_address()
    assert addr.startswith("T")
    assert len(addr) == 34  # standard Tron address length


@pytest.mark.asyncio
async def test_address_matches_tronpy():
    """Our address must match tronpy's derivation."""
    key = os.urandom(32)
    wallet = TronWallet(private_key=key)
    expected = PrivateKey(key).public_key.to_base58check_address()
    assert await wallet.get_address() == expected


# --- sign_message ---


@pytest.mark.asyncio
async def test_sign_message_deterministic(tron_wallet):
    sig1 = await tron_wallet.sign_message(b"test message")
    sig2 = await tron_wallet.sign_message(b"test message")
    assert sig1 == sig2


@pytest.mark.asyncio
async def test_sign_message_different_messages(tron_wallet):
    sig1 = await tron_wallet.sign_message(b"message A")
    sig2 = await tron_wallet.sign_message(b"message B")
    assert sig1 != sig2


@pytest.mark.asyncio
async def test_sign_message_matches_tronpy():
    """Our sign_message must produce the same result as tronpy PrivateKey.sign_msg."""
    key = os.urandom(32)
    wallet = TronWallet(private_key=key)
    tron_key = PrivateKey(key)

    msg = b"verify this tron message"
    our_sig = await wallet.sign_message(msg)
    tronpy_sig = tron_key.sign_msg(msg).hex()

    assert our_sig == tronpy_sig


@pytest.mark.asyncio
async def test_sign_message_produces_valid_signature(tron_wallet):
    """Signature must be 65 bytes (r=32 + s=32 + v=1)."""
    sig_hex = await tron_wallet.sign_message(b"check length")
    sig_bytes = bytes.fromhex(sig_hex)
    assert len(sig_bytes) == 65


# --- sign_raw ---


@pytest.mark.asyncio
async def test_sign_raw_deterministic(tron_wallet):
    raw = os.urandom(64)
    sig1 = await tron_wallet.sign_raw(raw)
    sig2 = await tron_wallet.sign_raw(raw)
    assert sig1 == sig2


@pytest.mark.asyncio
async def test_sign_raw_matches_tronpy():
    """sign_raw must match tronpy PrivateKey.sign_msg for same input."""
    key = os.urandom(32)
    wallet = TronWallet(private_key=key)
    tron_key = PrivateKey(key)

    raw_data = os.urandom(32)
    our_sig = await wallet.sign_raw(raw_data)
    tronpy_sig = tron_key.sign_msg(raw_data).hex()

    assert our_sig == tronpy_sig


# --- sign_typed_data (EIP-712) ---


EIP712_DATA = {
    "types": {
        "EIP712Domain": [
            {"name": "name", "type": "string"},
            {"name": "version", "type": "string"},
            {"name": "chainId", "type": "uint256"},
            {"name": "verifyingContract", "type": "address"},
        ],
        "Transfer": [
            {"name": "to", "type": "address"},
            {"name": "amount", "type": "uint256"},
            {"name": "nonce", "type": "uint256"},
        ],
    },
    "primaryType": "Transfer",
    "domain": {
        "name": "TestProtocol",
        "version": "1",
        "chainId": 728126428,  # Tron chainId
        "verifyingContract": "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
    },
    "message": {
        "to": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "amount": 1000000,
        "nonce": 0,
    },
}


@pytest.mark.asyncio
async def test_sign_typed_data_recover():
    """Sign EIP-712 with Tron key → recover signer via eth_account.

    Since Tron uses the same secp256k1 curve, the recovered Ethereum address
    should correspond to the same private key.
    """
    key = os.urandom(32)
    wallet = TronWallet(private_key=key)
    eth_addr = Account.from_key(key).address

    sig_hex = await wallet.sign_typed_data(EIP712_DATA)

    signable = encode_typed_data(full_message=EIP712_DATA)
    recovered = Account.recover_message(signable, signature=bytes.fromhex(sig_hex))
    assert recovered == eth_addr


@pytest.mark.asyncio
async def test_sign_typed_data_matches_eth_account():
    """Tron EIP-712 signature must be identical to eth_account's.

    Same private key + same EIP-712 data → must produce the same signature,
    because the underlying ECDSA operation is identical.
    """
    key = os.urandom(32)
    tron_wallet = TronWallet(private_key=key)
    eth_account = Account.from_key(key)

    tron_sig = await tron_wallet.sign_typed_data(EIP712_DATA)

    signable = encode_typed_data(full_message=EIP712_DATA)
    eth_sig = eth_account.sign_message(signable).signature.hex()

    assert tron_sig == eth_sig


@pytest.mark.asyncio
async def test_sign_typed_data_deterministic(tron_wallet):
    sig1 = await tron_wallet.sign_typed_data(EIP712_DATA)
    sig2 = await tron_wallet.sign_typed_data(EIP712_DATA)
    assert sig1 == sig2


# --- x402 behavioral compatibility ---


# EIP-712 domain WITHOUT version (x402 PaymentPermit style)
EIP712_NO_VERSION = {
    "types": {
        "EIP712Domain": [
            {"name": "name", "type": "string"},
            {"name": "chainId", "type": "uint256"},
            {"name": "verifyingContract", "type": "address"},
        ],
        "PaymentPermitDetails": [
            {"name": "buyer", "type": "address"},
            {"name": "amount", "type": "uint256"},
            {"name": "nonce", "type": "uint256"},
        ],
    },
    "primaryType": "PaymentPermitDetails",
    "domain": {
        "name": "x402PaymentPermit",
        "chainId": 728126428,  # Tron chainId
        "verifyingContract": "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
    },
    "message": {
        "buyer": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "amount": 1000000,
        "nonce": 0,
    },
}


def _x402_tron_sign_typed_data(private_key_hex: str, domain, types, message):
    """Replicate x402 TronClientSigner.sign_typed_data logic exactly.

    x402 Tron signer uses a FIXED EIP712Domain (name, chainId, verifyingContract)
    without version field.
    """
    EIP712_DOMAIN_TYPE = [
        {"name": "name", "type": "string"},
        {"name": "chainId", "type": "uint256"},
        {"name": "verifyingContract", "type": "address"},
    ]

    # x402 determines primaryType from types dict
    primary_type = list(types.keys())[-1]

    typed_data = {
        "types": {"EIP712Domain": EIP712_DOMAIN_TYPE, **types},
        "primaryType": primary_type,
        "domain": domain,
        "message": message,
    }

    signable = encode_typed_data(full_message=typed_data)
    private_key_bytes = bytes.fromhex(private_key_hex)
    signed_message = Account.sign_message(signable, private_key_bytes)
    return signed_message.signature.hex()


@pytest.mark.asyncio
async def test_x402_compat_no_version():
    """Our sign_typed_data must match x402 TronClientSigner for no-version domain."""
    key = os.urandom(32)
    wallet = TronWallet(private_key=key)

    our_sig = await wallet.sign_typed_data(EIP712_NO_VERSION)
    x402_sig = _x402_tron_sign_typed_data(
        key.hex(),
        domain=EIP712_NO_VERSION["domain"],
        types={"PaymentPermitDetails": EIP712_NO_VERSION["types"]["PaymentPermitDetails"]},
        message=EIP712_NO_VERSION["message"],
    )

    assert our_sig == x402_sig


@pytest.mark.asyncio
async def test_x402_compat_with_version():
    """Our sign_typed_data must also match x402 style for domain WITH version."""
    key = os.urandom(32)
    wallet = TronWallet(private_key=key)

    our_sig = await wallet.sign_typed_data(EIP712_DATA)

    # x402 EVM signer style (dynamic domain type from keys)
    _DOMAIN_FIELDS = [
        ("name", "string"), ("version", "string"),
        ("chainId", "uint256"), ("verifyingContract", "address"),
    ]
    domain_type = [
        {"name": n, "type": t}
        for n, t in _DOMAIN_FIELDS
        if n in EIP712_DATA["domain"]
    ]
    full_data = {
        "types": {"EIP712Domain": domain_type, "Transfer": EIP712_DATA["types"]["Transfer"]},
        "domain": EIP712_DATA["domain"],
        "primaryType": "Transfer",
        "message": EIP712_DATA["message"],
    }
    signable = encode_typed_data(full_message=full_data)
    x402_sig = Account.sign_message(signable, key).signature.hex()

    assert our_sig == x402_sig


@pytest.mark.asyncio
async def test_x402_compat_no_version_recover():
    """No-version domain: signature must still be recoverable."""
    key = os.urandom(32)
    wallet = TronWallet(private_key=key)
    eth_addr = Account.from_key(key).address

    sig_hex = await wallet.sign_typed_data(EIP712_NO_VERSION)

    signable = encode_typed_data(full_message=EIP712_NO_VERSION)
    recovered = Account.recover_message(signable, signature=bytes.fromhex(sig_hex))
    assert recovered == eth_addr


@pytest.mark.asyncio
async def test_x402_compat_evm_tron_no_version_same_sig():
    """Same key, same no-version domain → EVM and Tron must produce identical signature."""
    from agent_wallet.core.adapters.evm import EvmWallet

    key = os.urandom(32)
    evm_wallet = EvmWallet(private_key=key)
    tron_wallet = TronWallet(private_key=key)

    evm_sig = await evm_wallet.sign_typed_data(EIP712_NO_VERSION)
    tron_sig = await tron_wallet.sign_typed_data(EIP712_NO_VERSION)

    assert evm_sig == tron_sig


# --- Cross-key isolation ---


@pytest.mark.asyncio
async def test_different_keys_different_signatures():
    wallet_a = TronWallet(private_key=os.urandom(32))
    wallet_b = TronWallet(private_key=os.urandom(32))

    msg = b"same message"
    sig_a = await wallet_a.sign_message(msg)
    sig_b = await wallet_b.sign_message(msg)

    assert sig_a != sig_b


# --- Same key, EVM vs Tron typed data consistency ---


@pytest.mark.asyncio
async def test_evm_tron_typed_data_same_key_same_sig():
    """Same private key signing same EIP-712 data via EvmWallet and TronWallet
    must produce identical signatures."""
    from agent_wallet.core.adapters.evm import EvmWallet

    key = os.urandom(32)
    evm_wallet = EvmWallet(private_key=key)
    tron_wallet = TronWallet(private_key=key)

    evm_sig = await evm_wallet.sign_typed_data(EIP712_DATA)
    tron_sig = await tron_wallet.sign_typed_data(EIP712_DATA)

    assert evm_sig == tron_sig
