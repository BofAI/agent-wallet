"""Tests for EvmWallet — comprehensive sign/verify roundtrip."""

import os

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct, encode_typed_data

from agent_wallet.core.adapters.evm import EvmWallet


# Known test private key (DO NOT use in production)
TEST_KEY = bytes.fromhex(
    "4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b"
)
TEST_ADDRESS = Account.from_key(TEST_KEY).address


@pytest.fixture
def evm_wallet():
    return EvmWallet(private_key=TEST_KEY, chain_id="eip155:1")


# --- Address ---


@pytest.mark.asyncio
async def test_get_address(evm_wallet):
    addr = await evm_wallet.get_address()
    assert addr == TEST_ADDRESS


@pytest.mark.asyncio
async def test_get_address_checksum():
    """Address should be EIP-55 checksummed."""
    key = os.urandom(32)
    wallet = EvmWallet(private_key=key)
    addr = await wallet.get_address()
    assert addr == Account.from_key(key).address
    assert addr.startswith("0x")
    assert len(addr) == 42
    # Must not be all-lowercase (checksummed)
    assert addr != addr.lower()


# --- sign_message ---


@pytest.mark.asyncio
async def test_sign_message_deterministic(evm_wallet):
    sig1 = await evm_wallet.sign_message(b"test message")
    sig2 = await evm_wallet.sign_message(b"test message")
    assert sig1 == sig2


@pytest.mark.asyncio
async def test_sign_message_different_messages(evm_wallet):
    sig1 = await evm_wallet.sign_message(b"message A")
    sig2 = await evm_wallet.sign_message(b"message B")
    assert sig1 != sig2


@pytest.mark.asyncio
async def test_sign_message_recover():
    """Sign → recover signer address, verify it matches."""
    key = os.urandom(32)
    wallet = EvmWallet(private_key=key)
    expected_addr = Account.from_key(key).address

    msg = b"verify this message"
    sig_hex = await wallet.sign_message(msg)

    signable = encode_defunct(primitive=msg)
    recovered = Account.recover_message(signable, signature=bytes.fromhex(sig_hex))
    assert recovered == expected_addr


@pytest.mark.asyncio
async def test_sign_message_matches_eth_account():
    """Our signature must be byte-identical to eth_account's direct signing."""
    key = os.urandom(32)
    wallet = EvmWallet(private_key=key)
    account = Account.from_key(key)

    msg = b"compare signatures"
    our_sig = await wallet.sign_message(msg)

    signable = encode_defunct(primitive=msg)
    eth_sig = account.sign_message(signable).signature.hex()

    assert our_sig == eth_sig


# --- sign_typed_data ---


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
        "chainId": 1,
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
    """Sign EIP-712 → recover signer, verify it matches."""
    key = os.urandom(32)
    wallet = EvmWallet(private_key=key)
    expected_addr = Account.from_key(key).address

    sig_hex = await wallet.sign_typed_data(EIP712_DATA)

    signable = encode_typed_data(full_message=EIP712_DATA)
    recovered = Account.recover_message(signable, signature=bytes.fromhex(sig_hex))
    assert recovered == expected_addr


@pytest.mark.asyncio
async def test_sign_typed_data_matches_eth_account():
    """Our EIP-712 signature must match eth_account's direct signing."""
    key = os.urandom(32)
    wallet = EvmWallet(private_key=key)
    account = Account.from_key(key)

    our_sig = await wallet.sign_typed_data(EIP712_DATA)

    signable = encode_typed_data(full_message=EIP712_DATA)
    eth_sig = account.sign_message(signable).signature.hex()

    assert our_sig == eth_sig


@pytest.mark.asyncio
async def test_sign_typed_data_deterministic(evm_wallet):
    sig1 = await evm_wallet.sign_typed_data(EIP712_DATA)
    sig2 = await evm_wallet.sign_typed_data(EIP712_DATA)
    assert sig1 == sig2


# --- sign_transaction ---


@pytest.mark.asyncio
async def test_sign_transaction_eip1559():
    """Sign an EIP-1559 transaction and verify the signer."""
    key = os.urandom(32)
    wallet = EvmWallet(private_key=key)
    expected_addr = Account.from_key(key).address

    tx = {
        "to": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "value": 1000000000000000000,  # 1 ETH
        "gas": 21000,
        "maxFeePerGas": 20000000000,
        "maxPriorityFeePerGas": 1000000000,
        "nonce": 0,
        "chainId": 1,
        "type": 2,
    }

    signed_hex = await wallet.sign_transaction(tx)
    assert signed_hex.startswith("02")  # EIP-1559 type prefix

    # Recover sender from signed tx
    recovered = Account.recover_transaction(bytes.fromhex(signed_hex))
    assert recovered == expected_addr


@pytest.mark.asyncio
async def test_sign_transaction_matches_eth_account():
    """Our signed tx must be identical to eth_account's."""
    key = os.urandom(32)
    wallet = EvmWallet(private_key=key)
    account = Account.from_key(key)

    tx = {
        "to": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "value": 0,
        "gas": 21000,
        "maxFeePerGas": 20000000000,
        "maxPriorityFeePerGas": 1000000000,
        "nonce": 5,
        "chainId": 56,  # BSC
        "type": 2,
    }

    our_signed = await wallet.sign_transaction(tx)
    eth_signed = account.sign_transaction(tx).raw_transaction.hex()

    assert our_signed == eth_signed


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
        "chainId": 1,
        "verifyingContract": "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
    },
    "message": {
        "buyer": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "amount": 1000000,
        "nonce": 0,
    },
}


def _x402_evm_sign_typed_data(private_key: bytes, domain, types, message):
    """Replicate x402 EvmClientSigner.sign_typed_data logic exactly."""
    # x402 builds EIP712Domain dynamically from domain keys
    _DOMAIN_FIELDS = [
        ("name", "string"),
        ("version", "string"),
        ("chainId", "uint256"),
        ("verifyingContract", "address"),
        ("salt", "bytes32"),
    ]
    domain_type = [
        {"name": name, "type": typ}
        for name, typ in _DOMAIN_FIELDS
        if name in domain
    ]

    # x402 determines primaryType from types dict
    primary_type = list(types.keys())[-1]

    full_data = {
        "types": {"EIP712Domain": domain_type, **types},
        "domain": domain,
        "primaryType": primary_type,
        "message": message,
    }

    encoded = encode_typed_data(full_message=full_data)
    signed = Account.sign_message(encoded, private_key=private_key)
    return signed.signature.hex()


@pytest.mark.asyncio
async def test_x402_compat_with_version():
    """Our sign_typed_data must match x402's split-param signing (with version)."""
    key = os.urandom(32)
    wallet = EvmWallet(private_key=key)

    our_sig = await wallet.sign_typed_data(EIP712_DATA)
    x402_sig = _x402_evm_sign_typed_data(
        key,
        domain=EIP712_DATA["domain"],
        types={"Transfer": EIP712_DATA["types"]["Transfer"]},
        message=EIP712_DATA["message"],
    )

    assert our_sig == x402_sig


@pytest.mark.asyncio
async def test_x402_compat_no_version():
    """Our sign_typed_data must match x402 for domain WITHOUT version field."""
    key = os.urandom(32)
    wallet = EvmWallet(private_key=key)

    our_sig = await wallet.sign_typed_data(EIP712_NO_VERSION)
    x402_sig = _x402_evm_sign_typed_data(
        key,
        domain=EIP712_NO_VERSION["domain"],
        types={"PaymentPermitDetails": EIP712_NO_VERSION["types"]["PaymentPermitDetails"]},
        message=EIP712_NO_VERSION["message"],
    )

    assert our_sig == x402_sig


@pytest.mark.asyncio
async def test_x402_compat_no_version_recover():
    """Domain without version: signature must still be recoverable."""
    key = os.urandom(32)
    wallet = EvmWallet(private_key=key)
    expected_addr = Account.from_key(key).address

    sig_hex = await wallet.sign_typed_data(EIP712_NO_VERSION)

    signable = encode_typed_data(full_message=EIP712_NO_VERSION)
    recovered = Account.recover_message(signable, signature=bytes.fromhex(sig_hex))
    assert recovered == expected_addr


# --- Cross-key isolation ---


@pytest.mark.asyncio
async def test_different_keys_different_signatures():
    """Two different keys must produce different signatures for the same message."""
    wallet_a = EvmWallet(private_key=os.urandom(32))
    wallet_b = EvmWallet(private_key=os.urandom(32))

    msg = b"same message"
    sig_a = await wallet_a.sign_message(msg)
    sig_b = await wallet_b.sign_message(msg)

    assert sig_a != sig_b
