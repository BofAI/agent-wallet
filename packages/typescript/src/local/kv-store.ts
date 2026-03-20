import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { keccak256 } from "viem";
import { DecryptionError } from "../core/errors.js";

const SCRYPT_N = 262144;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 32;

const MASTER_SENTINEL = Buffer.from("agent-wallet", "utf-8");

interface KeystoreV3 {
  version: 3;
  crypto: {
    cipher: string;
    cipherparams: { iv: string };
    ciphertext: string;
    kdf: string;
    kdfparams: {
      dklen: number;
      n: number;
      r: number;
      p: number;
      salt: string;
    };
    mac: string;
  };
}

function deriveKey(password: string, salt: Uint8Array): Buffer {
  return scryptSync(Buffer.from(password, "utf-8"), salt, SCRYPT_DKLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 256 * SCRYPT_N * SCRYPT_R,
  }) as Buffer;
}

export function encryptBytes(plaintext: Uint8Array, password: string): KeystoreV3 {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const derivedKey = deriveKey(password, salt);

  const encryptionKey = derivedKey.subarray(0, 16);
  const cipher = createCipheriv("aes-128-ctr", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  const macKey = derivedKey.subarray(16);
  const macInput = Buffer.concat([macKey, ciphertext]);
  const mac = keccak256(macInput).slice(2); // strip 0x

  return {
    version: 3,
    crypto: {
      cipher: "aes-128-ctr",
      cipherparams: { iv: iv.toString("hex") },
      ciphertext: ciphertext.toString("hex"),
      kdf: "scrypt",
      kdfparams: {
        dklen: SCRYPT_DKLEN,
        n: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        salt: salt.toString("hex"),
      },
      mac,
    },
  };
}

export function decryptBytes(keystore: KeystoreV3, password: string): Uint8Array {
  const { crypto } = keystore;
  const { kdfparams } = crypto;

  const salt = Buffer.from(kdfparams.salt, "hex");
  const iv = Buffer.from(crypto.cipherparams.iv, "hex");
  const ciphertext = Buffer.from(crypto.ciphertext, "hex");
  const storedMac = crypto.mac;

  const derivedKey = deriveKey(password, salt);

  const macKey = derivedKey.subarray(16);
  const macInput = Buffer.concat([macKey, ciphertext]);
  const computedMac = keccak256(macInput).slice(2);

  if (computedMac !== storedMac) {
    throw new DecryptionError("MAC mismatch — wrong password or corrupted file");
  }

  const encryptionKey = derivedKey.subarray(0, 16);
  const decipher = createDecipheriv("aes-128-ctr", encryptionKey, iv);
  return Uint8Array.from(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

export class SecureKVStore {
  private secretsDir: string;
  private password: string;

  constructor(secretsDir: string, password: string) {
    this.secretsDir = secretsDir;
    this.password = password;

    if (!existsSync(secretsDir) || !statSync(secretsDir).isDirectory()) {
      throw new Error(`Secrets directory not found: ${secretsDir}`);
    }
  }

  initMaster(): void {
    const keystore = encryptBytes(MASTER_SENTINEL, this.password);
    this.writeJson("master.json", keystore);
  }

  verifyPassword(): boolean {
    const masterPath = join(this.secretsDir, "master.json");
    if (!existsSync(masterPath)) {
      throw new Error("master.json not found. Run `agent-wallet init` first.");
    }
    const keystore = this.readJson("master.json") as KeystoreV3;
    const plaintext = decryptBytes(keystore, this.password);
    if (Buffer.compare(Buffer.from(plaintext), MASTER_SENTINEL) !== 0) {
      throw new DecryptionError("master.json decrypted but sentinel mismatch");
    }
    return true;
  }

  loadSecret(name: string): Uint8Array {
    const keystore = this.readJson(`secret_${name}.json`) as KeystoreV3;
    return decryptBytes(keystore, this.password);
  }

  saveSecret(name: string, secret: Uint8Array): void {
    const keystore = encryptBytes(secret, this.password);
    this.writeJson(`secret_${name}.json`, keystore);
  }

  generateSecret(name: string, opts?: { length?: number }): Uint8Array {
    const secret = randomBytes(opts?.length ?? 32);
    this.saveSecret(name, secret);
    return Uint8Array.from(secret);
  }

  loadCredential(name: string): string | Record<string, unknown> {
    const keystore = this.readJson(`cred_${name}.json`) as KeystoreV3;
    const plaintext = decryptBytes(keystore, this.password);
    const text = Buffer.from(plaintext).toString("utf-8");
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // not JSON, return raw text
    }
    return text;
  }

  saveCredential(name: string, value: string | Record<string, unknown>): void {
    const plaintext =
      typeof value === "string"
        ? Buffer.from(value, "utf-8")
        : Buffer.from(JSON.stringify(value), "utf-8");
    const keystore = encryptBytes(plaintext, this.password);
    this.writeJson(`cred_${name}.json`, keystore);
  }

  private readJson(filename: string): unknown {
    const path = join(this.secretsDir, filename);
    if (!existsSync(path)) {
      throw new Error(`Keystore file not found: ${path}`);
    }
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  private writeJson(filename: string, data: unknown): void {
    const path = join(this.secretsDir, filename);
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
    try {
      chmodSync(path, 0o600);
    } catch {
      // ignore on platforms without chmod support
    }
  }
}
