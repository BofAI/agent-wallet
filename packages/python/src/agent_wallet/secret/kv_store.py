"""Secret layer: Keystore V3 encryption engine for private keys and credentials."""

from __future__ import annotations

import json
import os
from pathlib import Path

from Crypto.Cipher import AES
from Crypto.Protocol.KDF import scrypt as scrypt_kdf
from eth_hash.auto import keccak

from agent_wallet.core.errors import DecryptionError

# Keystore V3 scrypt parameters
SCRYPT_N = 262144
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32

# Sentinel value for master.json password verification
MASTER_SENTINEL = b"agent-wallet"


def _derive_key(password: str, salt: bytes) -> bytes:
    """Derive a 32-byte key from password + salt using scrypt."""
    return scrypt_kdf(
        password.encode("utf-8"),
        salt,
        key_len=SCRYPT_DKLEN,
        N=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
    )


def _encrypt_bytes(plaintext: bytes, password: str) -> dict:
    """Encrypt arbitrary bytes using Keystore V3 compatible format.

    Returns a JSON-serializable dict with Keystore V3 structure.
    """
    salt = os.urandom(32)
    iv = os.urandom(16)
    derived_key = _derive_key(password, salt)

    # AES-128-CTR: use first 16 bytes of derived key
    encryption_key = derived_key[:16]
    cipher = AES.new(encryption_key, AES.MODE_CTR, nonce=b"", initial_value=iv)
    ciphertext = cipher.encrypt(plaintext)

    # MAC: keccak256(mac_key + ciphertext)
    mac_key = derived_key[16:]
    mac = keccak(mac_key + ciphertext)

    return {
        "version": 3,
        "crypto": {
            "cipher": "aes-128-ctr",
            "cipherparams": {"iv": iv.hex()},
            "ciphertext": ciphertext.hex(),
            "kdf": "scrypt",
            "kdfparams": {
                "dklen": SCRYPT_DKLEN,
                "n": SCRYPT_N,
                "r": SCRYPT_R,
                "p": SCRYPT_P,
                "salt": salt.hex(),
            },
            "mac": mac.hex(),
        },
    }


def _decrypt_bytes(keystore: dict, password: str) -> bytes:
    """Decrypt a Keystore V3 compatible JSON dict back to plaintext bytes."""
    crypto = keystore["crypto"]
    kdfparams = crypto["kdfparams"]

    salt = bytes.fromhex(kdfparams["salt"])
    iv = bytes.fromhex(crypto["cipherparams"]["iv"])
    ciphertext = bytes.fromhex(crypto["ciphertext"])
    stored_mac = crypto["mac"]

    derived_key = _derive_key(password, salt)

    # Verify MAC before decrypting
    mac_key = derived_key[16:]
    computed_mac = keccak(mac_key + ciphertext).hex()
    if computed_mac != stored_mac:
        raise DecryptionError("MAC mismatch — wrong password or corrupted file")

    # Decrypt
    encryption_key = derived_key[:16]
    cipher = AES.new(encryption_key, AES.MODE_CTR, nonce=b"", initial_value=iv)
    return cipher.decrypt(ciphertext)


class SecureKVStore:
    """Keystore V3 based encryption engine for keys and credentials.

    Holds the password for the duration of its lifetime (typically only during
    WalletRegistry.__init__). After WalletRegistry init completes, both the
    password and this KVStore instance go out of scope.
    """

    def __init__(self, secrets_dir: str | Path, password: str) -> None:
        self._secrets_dir = Path(secrets_dir)
        self._password = password

        if not self._secrets_dir.is_dir():
            raise FileNotFoundError(f"Secrets directory not found: {self._secrets_dir}")

    # --- Master Password ---

    def init_master(self) -> None:
        """Create master.json sentinel file (called by `agent-wallet init`)."""
        keystore = _encrypt_bytes(MASTER_SENTINEL, self._password)
        self._write_json("master.json", keystore)

    def verify_password(self) -> bool:
        """Verify password against master.json sentinel.

        Raises DecryptionError if password is wrong.
        Returns True on success.
        """
        path = self._secrets_dir / "master.json"
        if not path.exists():
            raise FileNotFoundError(
                "master.json not found. Run `agent-wallet init` first."
            )
        keystore = self._read_json("master.json")
        plaintext = _decrypt_bytes(keystore, self._password)
        if plaintext != MASTER_SENTINEL:
            raise DecryptionError("master.json decrypted but sentinel mismatch")
        return True

    # --- Identity (private keys, fixed 32 bytes) ---

    def load_private_key(self, name: str) -> bytes:
        """Decrypt id_<name>.json and return raw 32-byte private key."""
        filename = f"id_{name}.json"
        keystore = self._read_json(filename)
        return _decrypt_bytes(keystore, self._password)

    def save_private_key(self, name: str, private_key: bytes) -> None:
        """Encrypt and save a 32-byte private key as id_<name>.json."""
        if len(private_key) != 32:
            raise ValueError(f"Private key must be 32 bytes, got {len(private_key)}")
        keystore = _encrypt_bytes(private_key, self._password)
        self._write_json(f"id_{name}.json", keystore)

    def generate_key(self, name: str) -> bytes:
        """Generate a random 32-byte private key, save it, return the key."""
        private_key = os.urandom(32)
        self.save_private_key(name, private_key)
        return private_key

    # --- Credentials (arbitrary length) ---

    def load_credential(self, name: str) -> str | dict:
        """Decrypt cred_<name>.json and return the credential value."""
        filename = f"cred_{name}.json"
        keystore = self._read_json(filename)
        plaintext = _decrypt_bytes(keystore, self._password)
        text = plaintext.decode("utf-8")
        # Try to parse as JSON dict (for structured credentials)
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
        return text

    def save_credential(self, name: str, value: str | dict) -> None:
        """Encrypt and save a credential as cred_<name>.json."""
        if isinstance(value, dict):
            plaintext = json.dumps(value, ensure_ascii=False).encode("utf-8")
        else:
            plaintext = value.encode("utf-8")
        keystore = _encrypt_bytes(plaintext, self._password)
        self._write_json(f"cred_{name}.json", keystore)

    # --- Internal helpers ---

    def _read_json(self, filename: str) -> dict:
        path = self._secrets_dir / filename
        if not path.exists():
            raise FileNotFoundError(f"Keystore file not found: {path}")
        return json.loads(path.read_text(encoding="utf-8"))

    def _write_json(self, filename: str, data: dict) -> None:
        path = self._secrets_dir / filename
        path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
