"""Secret layer: Keystore V3 encryption engine for secrets."""

from __future__ import annotations

import json
import os
from pathlib import Path

from Crypto.Cipher import AES
from Crypto.Protocol.KDF import scrypt as scrypt_kdf
from eth_hash.auto import keccak

from agent_wallet.core.errors import DecryptionError
from agent_wallet.core.utils import safe_chmod

# Keystore V3 scrypt parameters
DEFAULT_SCRYPT_N = 262144
DEFAULT_SCRYPT_R = 8
DEFAULT_SCRYPT_P = 1
DEFAULT_SCRYPT_DKLEN = 32
TEST_SCRYPT_N = 16384

# Sentinel value for master.json password verification
MASTER_SENTINEL = b"agent-wallet"


def _derive_key(
    password: str,
    salt: bytes,
    *,
    n: int | None = None,
    r: int | None = None,
    p: int | None = None,
    dklen: int | None = None,
) -> bytes:
    """Derive a key from password + salt using scrypt."""
    if n is None or r is None or p is None or dklen is None:
        n, r, p, dklen = _scrypt_params()
    return scrypt_kdf(
        password.encode("utf-8"),
        salt,
        key_len=dklen,
        N=n,
        r=r,
        p=p,
    )


def _scrypt_params() -> tuple[int, int, int, int]:
    explicit_n = os.environ.get("AGENT_WALLET_TEST_SCRYPT_N")
    if explicit_n:
        try:
            n = int(explicit_n)
        except ValueError:
            n = DEFAULT_SCRYPT_N
        else:
            if n > 1:
                return n, DEFAULT_SCRYPT_R, DEFAULT_SCRYPT_P, DEFAULT_SCRYPT_DKLEN
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return TEST_SCRYPT_N, DEFAULT_SCRYPT_R, DEFAULT_SCRYPT_P, DEFAULT_SCRYPT_DKLEN
    return DEFAULT_SCRYPT_N, DEFAULT_SCRYPT_R, DEFAULT_SCRYPT_P, DEFAULT_SCRYPT_DKLEN


def _encrypt_bytes(plaintext: bytes, password: str) -> dict:
    """Encrypt arbitrary bytes using Keystore V3 compatible format.

    Returns a JSON-serializable dict with Keystore V3 structure.
    """
    scrypt_n, scrypt_r, scrypt_p, scrypt_dklen = _scrypt_params()
    salt = os.urandom(32)
    iv = os.urandom(16)
    derived_key = _derive_key(
        password,
        salt,
        n=scrypt_n,
        r=scrypt_r,
        p=scrypt_p,
        dklen=scrypt_dklen,
    )

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
                "dklen": scrypt_dklen,
                "n": scrypt_n,
                "r": scrypt_r,
                "p": scrypt_p,
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

    derived_key = _derive_key(
        password,
        salt,
        n=int(kdfparams["n"]),
        r=int(kdfparams["r"]),
        p=int(kdfparams["p"]),
        dklen=int(kdfparams["dklen"]),
    )

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
    """Keystore V3 based encryption engine for secret material.

    Holds the password for the duration of its lifetime (typically only during
    wallet resolution). After init completes, both the password
    and this KVStore instance go out of scope.
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

    # --- Secrets ---

    def load_secret(self, name: str) -> bytes:
        """Decrypt secret_<name>.json and return raw bytes."""
        filename = f"secret_{name}.json"
        keystore = self._read_json(filename)
        return _decrypt_bytes(keystore, self._password)

    def save_secret(self, name: str, secret: bytes) -> None:
        """Encrypt and save arbitrary bytes as secret_<name>.json."""
        keystore = _encrypt_bytes(secret, self._password)
        self._write_json(f"secret_{name}.json", keystore)

    def generate_secret(self, name: str, *, length: int = 32) -> bytes:
        """Generate a random 32-byte private key, save it, return the key."""
        secret = os.urandom(length)
        self.save_secret(name, secret)
        return secret

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
        safe_chmod(path, 0o600)
